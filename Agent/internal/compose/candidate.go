package compose

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

type hintCandidate struct {
	Text        string   `json:"text"`
	UsedSignals []string `json:"used_signals"`
}

type hintCandidateEnvelope struct {
	Candidates []hintCandidate `json:"candidates"`
}

type scoredCandidate struct {
	Candidate hintCandidate
	Score     int
	Issues    []string
}

var numberPattern = regexp.MustCompile(`[0-9０-９]`)

var vagueWords = []string{
	"影",
	"気配",
	"違和感",
	"不穏",
	"怪しい",
}

func parseCandidateResponse(raw string) ([]hintCandidate, error) {
	clean := stripCodeFence(raw)
	var envelope hintCandidateEnvelope
	if err := json.Unmarshal([]byte(clean), &envelope); err != nil {
		return nil, fmt.Errorf("parse candidate response: %w", err)
	}
	if len(envelope.Candidates) == 0 {
		return nil, fmt.Errorf("parse candidate response: candidates is empty")
	}
	return envelope.Candidates, nil
}

func stripCodeFence(raw string) string {
	clean := strings.TrimSpace(raw)
	if strings.HasPrefix(clean, "```") {
		lines := strings.Split(clean, "\n")
		if len(lines) >= 3 {
			lines = lines[1 : len(lines)-1]
			clean = strings.Join(lines, "\n")
		}
	}
	return strings.TrimSpace(clean)
}

func scoreCandidates(candidates []hintCandidate, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, directives []candidateDirective) []scoredCandidate {
	scored := make([]scoredCandidate, 0, len(candidates))
	for idx, candidate := range candidates {
		issues := validateCandidate(candidate, ev, hintPolicy, summary, selected)
		score := candidateScore(candidate, hintPolicy, summary, selected, issues)
		if idx < len(directives) {
			score += directiveFitScore(candidate, directives[idx])
		}
		scored = append(scored, scoredCandidate{
			Candidate: candidate,
			Score:     score,
			Issues:    issues,
		})
	}
	applySimilarityPenalties(scored, summary)
	slices.SortFunc(scored, func(a, b scoredCandidate) int {
		if a.Score != b.Score {
			return b.Score - a.Score
		}
		return utf8.RuneCountInString(a.Candidate.Text) - utf8.RuneCountInString(b.Candidate.Text)
	})
	return scored
}

func validateCandidate(candidate hintCandidate, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials) []string {
	issues := []string{}
	text := strings.TrimSpace(candidate.Text)

	if text == "" {
		issues = append(issues, "text is empty")
	}
	if utf8.RuneCountInString(text) > 50 {
		issues = append(issues, "text is too long")
	}
	if len(candidate.UsedSignals) == 0 {
		issues = append(issues, "used_signals is empty")
	}
	if len(candidate.UsedSignals) > hintPolicy.MaxClues {
		issues = append(issues, "too many used_signals")
	}

	allowedSignals := allowedCandidateSignals(selected, hintPolicy)
	for _, signal := range candidate.UsedSignals {
		if _, ok := allowedSignals[policy.SignalName(signal)]; !ok {
			issues = append(issues, "contains disallowed signal: "+signal)
		}
	}

	if hasForbiddenPrefix(text) {
		issues = append(issues, "contains forbidden label")
	}
	if numberPattern.MatchString(text) {
		issues = append(issues, "contains numeric distance or digits")
	}
	if containsForbiddenFragments(text, ev.Request) {
		issues = append(issues, "contains identifiable fragment")
	}
	if repeatedRecentText(text, summary) {
		issues = append(issues, "duplicates recent hint")
	}

	return issues
}

func candidateScore(candidate hintCandidate, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, issues []string) int {
	score := 100 - len(issues)*25

	if candidateUsesClue(candidate, selected.PrimaryClue) {
		score += 15
	}
	if hintPolicy.RequireThemeMismatchHint {
		if containsSignal(candidate.UsedSignals, string(policy.SignalThemeMismatch)) {
			score += 10
		} else {
			score -= 10
		}
	}

	runeLen := utf8.RuneCountInString(strings.TrimSpace(candidate.Text))
	switch {
	case runeLen <= 20:
		score += 4
	case runeLen <= 35:
		score += 8
	case runeLen <= 50:
		score += 4
	}

	if len(candidate.UsedSignals) >= 1 && len(candidate.UsedSignals) <= hintPolicy.MaxClues {
		score += 5
	}
	if overlapsRecentText(candidate.Text, summary) {
		score -= 8
	}
	if overlapsRecentSignals(candidate.UsedSignals, summary) {
		score -= 6
	}
	if containsConcreteSignalLanguage(candidate.Text, candidate.UsedSignals) {
		score += 12
	}
	if countConcreteClues(candidate.Text, candidate.UsedSignals) >= 2 {
		score += 10
	}
	if containsOnlyVagueCue(candidate.Text) {
		score -= 18
	}
	if containsVagueWord(candidate.Text) && !containsConcreteSignalLanguage(candidate.Text, candidate.UsedSignals) {
		score -= 8
	}

	return score
}

func directiveFitScore(candidate hintCandidate, directive candidateDirective) int {
	if candidateUsesClue(candidate, directive.PrimaryClue) {
		return 8
	}
	return -4
}

func applySimilarityPenalties(scored []scoredCandidate, summary ops.RecentHintSummary) {
	for i := range scored {
		for j := i + 1; j < len(scored); j++ {
			if candidateTextsAreSimilar(scored[i].Candidate.Text, scored[j].Candidate.Text) {
				scored[j].Score -= 7
			}
			if candidateSignalSetsMatch(scored[i].Candidate.UsedSignals, scored[j].Candidate.UsedSignals) {
				scored[j].Score -= 4
			}
		}
		if resemblesRecentHint(scored[i].Candidate.Text, summary) {
			scored[i].Score -= 10
		}
	}
}

func candidateUsesClue(candidate hintCandidate, clue material.ClueKind) bool {
	switch clue {
	case material.ClueMovement:
		return containsSignal(candidate.UsedSignals, string(policy.SignalMotion))
	case material.ClueLocation:
		return containsSignal(candidate.UsedSignals, string(policy.SignalZone)) ||
			containsSignal(candidate.UsedSignals, string(policy.SignalNearWall)) ||
			containsSignal(candidate.UsedSignals, string(policy.SignalLandmark))
	case material.ClueFacing:
		return containsSignal(candidate.UsedSignals, string(policy.SignalFacing))
	case material.ClueRelation:
		return containsSignal(candidate.UsedSignals, string(policy.SignalRelation))
	case material.ClueThemeMismatch:
		return containsSignal(candidate.UsedSignals, string(policy.SignalThemeMismatch))
	default:
		return false
	}
}

func containsSignal(signals []string, target string) bool {
	for _, signal := range signals {
		if signal == target {
			return true
		}
	}
	return false
}

func overlapsRecentText(text string, summary ops.RecentHintSummary) bool {
	for _, recent := range summary.RecentTexts {
		if recent == "" {
			continue
		}
		if strings.Contains(text, recent) || strings.Contains(recent, text) {
			return true
		}
	}
	return false
}

func resemblesRecentHint(text string, summary ops.RecentHintSummary) bool {
	for _, recent := range summary.RecentTexts {
		if textSimilarity(text, recent) >= 0.6 {
			return true
		}
	}
	return false
}

func overlapsRecentSignals(signals []string, summary ops.RecentHintSummary) bool {
	if len(signals) == 0 || len(summary.RecentSignals) == 0 {
		return false
	}
	count := 0
	for _, signal := range signals {
		if slices.Contains(summary.RecentSignals, signal) {
			count++
		}
	}
	return count == len(signals)
}

func candidateTextsAreSimilar(a, b string) bool {
	return textSimilarity(a, b) >= 0.65
}

func candidateSignalSetsMatch(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := slices.Clone(a)
	bb := slices.Clone(b)
	slices.Sort(aa)
	slices.Sort(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}

func containsConcreteSignalLanguage(text string, usedSignals []string) bool {
	for _, signal := range usedSignals {
		if signalHasConcreteCue(text, signal) {
			return true
		}
	}
	return false
}

func countConcreteClues(text string, usedSignals []string) int {
	count := 0
	seen := map[string]struct{}{}
	for _, signal := range usedSignals {
		if _, ok := seen[signal]; ok {
			continue
		}
		seen[signal] = struct{}{}
		if signalHasConcreteCue(text, signal) {
			count++
		}
	}
	return count
}

func signalHasConcreteCue(text, signal string) bool {
	cues := concreteCuesForSignal(signal)
	for _, cue := range cues {
		if strings.Contains(text, cue) {
			return true
		}
	}
	return false
}

func concreteCuesForSignal(signal string) []string {
	switch signal {
	case string(policy.SignalMotion):
		return []string{"走", "歩", "静止", "止まり", "攻撃", "尻尾"}
	case string(policy.SignalMouth):
		return []string{"口を開け", "口が開"}
	case string(policy.SignalAirborne):
		return []string{"ジャンプ", "跳"}
	case string(policy.SignalZone):
		return []string{"外周", "中央", "中間", "北", "南", "東", "西"}
	case string(policy.SignalNearWall):
		return []string{"壁際", "壁の近く"}
	case string(policy.SignalLandmark):
		return []string{"岩", "木"}
	case string(policy.SignalFacing):
		return []string{"向き", "北向き", "南向き", "東向き", "西向き"}
	case string(policy.SignalRelation):
		return []string{"近く", "孤立", "離れ"}
	case string(policy.SignalThemeMismatch):
		return []string{"周囲", "噛み合", "流れ"}
	default:
		return nil
	}
}

func containsOnlyVagueCue(text string) bool {
	if containsConcreteSignalLanguage(text, []string{
		string(policy.SignalMotion),
		string(policy.SignalMouth),
		string(policy.SignalAirborne),
		string(policy.SignalZone),
		string(policy.SignalNearWall),
		string(policy.SignalLandmark),
		string(policy.SignalFacing),
		string(policy.SignalRelation),
	}) {
		return false
	}
	return containsVagueWord(text)
}

func containsVagueWord(text string) bool {
	for _, word := range vagueWords {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}

func textSimilarity(a, b string) float64 {
	aTokens := tokenizeForSimilarity(a)
	bTokens := tokenizeForSimilarity(b)
	if len(aTokens) == 0 || len(bTokens) == 0 {
		return 0
	}

	setA := make(map[string]struct{}, len(aTokens))
	setB := make(map[string]struct{}, len(bTokens))
	for _, token := range aTokens {
		setA[token] = struct{}{}
	}
	for _, token := range bTokens {
		setB[token] = struct{}{}
	}

	intersection := 0
	for token := range setA {
		if _, ok := setB[token]; ok {
			intersection++
		}
	}
	union := len(setA)
	for token := range setB {
		if _, ok := setA[token]; !ok {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func tokenizeForSimilarity(text string) []string {
	normalized := strings.NewReplacer(
		"、", " ",
		"。", " ",
		"・", " ",
		"　", " ",
	).Replace(strings.TrimSpace(text))
	parts := strings.Fields(normalized)
	tokens := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		tokens = append(tokens, part)
		runes := []rune(part)
		if len(runes) == 1 {
			tokens = append(tokens, part)
			continue
		}
		for i := 0; i < len(runes)-1; i++ {
			tokens = append(tokens, string(runes[i:i+2]))
		}
	}
	return tokens
}

func hasForbiddenPrefix(text string) bool {
	prefixes := []string{
		"監視AI通報",
		"監視AI:",
		"監視AI：",
		"通報:",
		"通報：",
		"Agent:",
		"Agent：",
	}
	for _, prefix := range prefixes {
		if strings.Contains(text, prefix) {
			return true
		}
	}
	return false
}

func containsForbiddenFragments(text string, req domain.HintRequest) bool {
	fragments := []string{}
	for _, player := range req.Players {
		if strings.TrimSpace(player.DisplayName) != "" {
			fragments = append(fragments, player.DisplayName)
		}
		if strings.TrimSpace(player.Color) != "" {
			fragments = append(fragments, player.Color)
		}
	}
	if strings.TrimSpace(req.AllyTheme) != "" {
		fragments = append(fragments, req.AllyTheme)
	}
	if strings.TrimSpace(req.EnemyTheme) != "" {
		fragments = append(fragments, req.EnemyTheme)
	}

	for _, fragment := range fragments {
		if fragment != "" && strings.Contains(text, fragment) {
			return true
		}
	}
	return false
}

func allowedCandidateSignals(selected material.SelectedMaterials, hintPolicy policy.HintPolicy) map[policy.SignalName]struct{} {
	allowed := make(map[policy.SignalName]struct{})
	add := func(enabled bool, signal policy.SignalName) {
		if enabled {
			allowed[signal] = struct{}{}
		}
	}

	for _, clue := range selected.Clues {
		switch clue {
		case material.ClueMovement:
			add(hintPolicy.Signals.UseMotion, policy.SignalMotion)
			add(hintPolicy.Signals.UseMouth, policy.SignalMouth)
			add(hintPolicy.Signals.UseAirborne, policy.SignalAirborne)
		case material.ClueLocation:
			add(hintPolicy.Signals.UseZone, policy.SignalZone)
			add(hintPolicy.Signals.UseNearWall, policy.SignalNearWall)
			add(hintPolicy.Signals.UseLandmark, policy.SignalLandmark)
		case material.ClueFacing:
			add(hintPolicy.Signals.UseFacing, policy.SignalFacing)
		case material.ClueRelation:
			add(hintPolicy.Signals.UseRelation, policy.SignalRelation)
		case material.ClueThemeMismatch:
			add(hintPolicy.Signals.UseThemeMismatch, policy.SignalThemeMismatch)
		}
	}

	return allowed
}

func selectedSignalNames(selected material.SelectedMaterials, hintPolicy policy.HintPolicy) []string {
	names := make([]string, 0, len(allowedCandidateSignals(selected, hintPolicy)))
	for signal := range allowedCandidateSignals(selected, hintPolicy) {
		names = append(names, string(signal))
	}
	slices.Sort(names)
	return names
}

func bestValidCandidate(scored []scoredCandidate) (hintCandidate, error) {
	for _, candidate := range scored {
		if len(candidate.Issues) == 0 {
			return candidate.Candidate, nil
		}
	}
	return hintCandidate{}, fmt.Errorf("no valid candidate")
}

func topValidCandidates(scored []scoredCandidate, limit int) []hintCandidate {
	if limit <= 0 {
		return nil
	}
	top := make([]hintCandidate, 0, limit)
	for _, candidate := range scored {
		if len(candidate.Issues) != 0 {
			continue
		}
		top = append(top, candidate.Candidate)
		if len(top) >= limit {
			break
		}
	}
	return top
}

func summarizeCandidateIssues(scored []scoredCandidate) []string {
	seen := map[string]struct{}{}
	issues := []string{}
	for _, candidate := range scored {
		for _, issue := range candidate.Issues {
			if _, ok := seen[issue]; ok {
				continue
			}
			seen[issue] = struct{}{}
			issues = append(issues, issue)
		}
	}
	slices.Sort(issues)
	return issues
}
