import { createElement } from 'lucide';
import type { IconNode } from 'lucide';
import {
  Gamepad2, Eye, Zap, Swords, Search, Vote,
  ShieldAlert, User, Check, Radio, Trophy, Skull, Users,
} from 'lucide';

function svg(def: IconNode, size = 20): string {
  const el = createElement(def, { width: size, height: size } as Record<string, string | number>);
  return el.outerHTML;
}

export const IC = {
  gamepad:     (s = 20) => svg(Gamepad2, s),
  eye:         (s = 20) => svg(Eye, s),
  zap:         (s = 20) => svg(Zap, s),
  swords:      (s = 20) => svg(Swords, s),
  search:      (s = 20) => svg(Search, s),
  vote:        (s = 20) => svg(Vote, s),
  shieldAlert: (s = 20) => svg(ShieldAlert, s),
  user:        (s = 20) => svg(User, s),
  check:       (s = 20) => svg(Check, s),
  radio:       (s = 20) => svg(Radio, s),
  trophy:      (s = 20) => svg(Trophy, s),
  skull:       (s = 20) => svg(Skull, s),
  users:       (s = 20) => svg(Users, s),
} as const;
