package compose

import (
	"fmt"

	"agent/internal/material"
	"agent/internal/policy"
)

type candidateDirective struct {
	Index       int
	PrimaryClue material.ClueKind
	Instruction string
}

func buildCandidateDirectives(selected material.SelectedMaterials, hintPolicy policy.HintPolicy) []candidateDirective {
	count := hintPolicy.CandidateCount
	if count <= 0 {
		count = 3
	}

	clues := selected.Clues
	if len(clues) == 0 {
		clues = []material.ClueKind{selected.PrimaryClue}
	}

	directives := make([]candidateDirective, 0, count)
	for i := 0; i < count; i++ {
		clue := clues[i%len(clues)]
		directives = append(directives, candidateDirective{
			Index:       i,
			PrimaryClue: clue,
			Instruction: directiveInstruction(clue, i),
		})
	}
	return directives
}

func directiveInstruction(clue material.ClueKind, index int) string {
	switch clue {
	case material.ClueMovement:
		return fmt.Sprintf("候補%d: 行動中心。走る・止まる・口の動きなど、観測できる動作をそのまま短く言う", index+1)
	case material.ClueLocation:
		return fmt.Sprintf("候補%d: 位置中心。外周/中央/壁際/岩や木の近くなど、場所が絞れる情報を主役にする", index+1)
	case material.ClueRelation:
		return fmt.Sprintf("候補%d: 関係性中心。誰かの近く・少し孤立など、他プレイヤーとの距離感を主役にする", index+1)
	case material.ClueThemeMismatch:
		return fmt.Sprintf("候補%d: 周囲とのズレ中心。市民の流れと噛み合わない行動を具体的に短く言う", index+1)
	case material.ClueFacing:
		return fmt.Sprintf("候補%d: 向き中心。どちらを向き続けるか、向きと止まり方の癖を主役にする", index+1)
	default:
		return fmt.Sprintf("候補%d: 別の切り口で具体的に言う", index+1)
	}
}
