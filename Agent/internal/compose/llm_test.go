package compose

import (
	"context"
	"strings"
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/ops"
	"agent/internal/policy"
)

type fakeLLMClient struct {
	inputs  []llm.PromptInput
	outputs []string
	err     error
	calls   int
}

func (f *fakeLLMClient) Generate(_ context.Context, input llm.PromptInput) (string, error) {
	f.inputs = append(f.inputs, input)
	if f.err != nil {
		return "", f.err
	}
	if len(f.outputs) == 0 {
		return "", nil
	}
	if f.calls >= len(f.outputs) {
		return f.outputs[len(f.outputs)-1], nil
	}
	output := f.outputs[f.calls]
	f.calls++
	return output, nil
}

func TestLLMComposer_BuildsPromptAndOmitsIdentifiers(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 60,
		ElapsedSec:   30,
		MapRadius:    1.3,
		AllyTheme:    "みんなで円を描く",
		EnemyTheme:   "端で待ち伏せする",
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				DisplayName:   "Enemy",
				Color:         "red",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{
				PlayerID:    "citizen-1",
				DisplayName: "CitizenOne",
				Color:       "blue",
				X:           0.72,
				Z:           0.62,
				Animation:   "Idle",
			},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "rock", X: 0.95, Z: 0.67},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	hintPolicy.MaxClues = 4
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"外周で落ち着かない動きがある","used_signals":["motion","zone"]},{"text":"周囲と噛み合わない影がある","used_signals":["theme_mismatch","motion"]},{"text":"壁際で不自然に止まる気配","used_signals":["zone","near_wall"]}]}`,
	}}
	composer := NewLLMComposer(client)

	summary := ops.RecentHintSummary{RecentTexts: []string{"外周で怪しい動きがある"}}
	if _, err := composer.Compose(context.Background(), ev, hintPolicy, summary); err != nil {
		t.Fatalf("compose returned error: %v", err)
	}

	forbiddenFragments := []string{
		"Enemy",
		"CitizenOne",
		"red",
		"blue",
		"最も近い",
		"0.25",
	}
	for _, fragment := range forbiddenFragments {
		if strings.Contains(client.inputs[0].User, fragment) {
			t.Fatalf("prompt should omit forbidden fragment %q: %s", fragment, client.inputs[0].User)
		}
	}

	requiredFragments := []string{
		"主軸: 行動",
		"使ってよい情報",
		"今回使う材料",
		"今回使える signal 名",
		"手がかり数の上限",
		"JSONのみを返してください",
		"口の開き",
		"ジャンプ",
		"向き",
		"行動ミッション（テーマ）",
		"テーマとのズレ",
		"市民側の流れと噛み合わない",
		"直近ヒント履歴",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(client.inputs[0].User, fragment) {
			t.Fatalf("prompt should contain %q: %s", fragment, client.inputs[0].User)
		}
	}
}

func TestLLMComposer_SelectsBestValidCandidate(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 60,
		ElapsedSec:   30,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	hintPolicy.MaxClues = 4
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"近くで怪しい動き","used_signals":["color"]},{"text":"外周で落ち着かない動きがある","used_signals":["motion","zone"]},{"text":"監視AI通報: 壁際が怪しい","used_signals":["zone"]}]}`,
	}}

	text, err := NewLLMComposer(client).Compose(context.Background(), ev, hintPolicy, ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != "外周で落ち着かない動きがある" {
		t.Fatalf("unexpected selected text: %s", text)
	}
}

func TestLLMComposer_RetriesWhenInitialResponseIsInvalid(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 60,
		ElapsedSec:   30,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"監視AI通報: 赤い敵がいる","used_signals":["motion"]}]}`,
		`{"candidates":[{"text":"外周で不自然な静けさがある","used_signals":["motion","zone"]}]}`,
	}}

	text, err := NewLLMComposer(client).Compose(context.Background(), ev, hintPolicy, ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != "外周で不自然な静けさがある" {
		t.Fatalf("unexpected retried text: %s", text)
	}
	if len(client.inputs) != 2 {
		t.Fatalf("expected retry call, got %d requests", len(client.inputs))
	}
	if !strings.Contains(client.inputs[1].User, "修正指示") {
		t.Fatalf("expected repair prompt on retry: %s", client.inputs[1].User)
	}
}

func TestLLMComposer_PrefersCandidateThatAvoidsRecentCut(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   3,
		GameDuration: 60,
		ElapsedSec:   45,
		MapRadius:    1.3,
		AllyTheme:    "みんなで円を描く",
		EnemyTheme:   "端で待ち伏せする",
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	summary := ops.RecentHintSummary{
		RecentTexts:   []string{"外周で落ち着かない動きがある"},
		RecentFocuses: []string{"location"},
		RecentSignals: []string{"motion", "zone"},
	}
	hintPolicy := policy.BuildHintPolicy(ev, summary)
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"外周で落ち着かない動きがある","used_signals":["motion","zone"]},{"text":"周囲と噛み合わない静けさがある","used_signals":["theme_mismatch","motion"]},{"text":"外周で不自然な静けさがある","used_signals":["zone"]}]}`,
	}}

	text, err := NewLLMComposer(client).Compose(context.Background(), ev, hintPolicy, summary)
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != "周囲と噛み合わない静けさがある" {
		t.Fatalf("expected less repetitive candidate to be selected, got %s", text)
	}
}

func TestLLMComposer_UsesJudgeDecisionWhenAvailable(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   3,
		GameDuration: 60,
		ElapsedSec:   45,
		MapRadius:    1.3,
		AllyTheme:    "みんなで円を描く",
		EnemyTheme:   "端で待ち伏せする",
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	hintPolicy.MaxClues = 4
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"外周で不自然な静けさがある","used_signals":["motion","zone"]},{"text":"周囲と噛み合わない影がある","used_signals":["theme_mismatch","motion"]},{"text":"壁際で不自然に止まる気配","used_signals":["zone","near_wall"]}]}`,
		`{"selected_index":0,"reason":"テーマ差分を短く示唆できている"}`,
	}}

	text, err := NewLLMComposer(client).Compose(context.Background(), ev, hintPolicy, ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != "周囲と噛み合わない影がある" {
		t.Fatalf("expected judge-selected candidate, got %s", text)
	}
	if len(client.inputs) != 2 {
		t.Fatalf("expected candidate and judge calls, got %d", len(client.inputs))
	}
	if !strings.Contains(client.inputs[1].System, "軽量Judge") {
		t.Fatalf("expected judge prompt to use judge system prompt: %s", client.inputs[1].System)
	}
}

func TestLLMComposer_FallsBackToRuleBestWhenJudgeFails(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   3,
		GameDuration: 60,
		ElapsedSec:   45,
		MapRadius:    1.3,
		AllyTheme:    "みんなで円を描く",
		EnemyTheme:   "端で待ち伏せする",
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	hintPolicy.MaxClues = 4
	client := &fakeLLMClient{outputs: []string{
		`{"candidates":[{"text":"外周で不自然な静けさがある","used_signals":["motion","zone"]},{"text":"周囲と噛み合わない影がある","used_signals":["theme_mismatch","motion"]}]}`,
		`{"selected_index":99,"reason":"invalid"}`,
	}}

	text, err := NewLLMComposer(client).Compose(context.Background(), ev, hintPolicy, ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != "周囲と噛み合わない影がある" {
		t.Fatalf("expected fallback to rule-based best, got %s", text)
	}
}
