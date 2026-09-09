/**
 * The game's words, read out of `DIALOGUE.md`.
 *
 * The file is the source rather than a description of one: it is parsed at
 * load and there is no copy of it in the code, so editing a line there
 * changes the line in the game. That is the whole point of it -- writing
 * dialogue is writing, and writing it inside nested object literals with
 * quotes to escape is not.
 *
 * Markdown because it is what the file already wanted to be. A conversation
 * is a tree of things somebody might say, and a nested bullet list *is* a
 * tree -- one an editor will indent for you and a reviewer can read without
 * knowing anything about this game. The notation is set out in the file
 * itself, which is the place somebody editing it will be looking.
 *
 * It throws on anything it cannot read, with the line number. A script that
 * half-parsed would be a conversation with a branch quietly missing, and the
 * only way to find that is to play the whole game.
 */

import script from '../DIALOGUE.md?raw';
import type { Words } from './i18n';
import type { Reply, Turn } from './dialogue';

/** English before the pipe, Hungarian after. */
const SPLIT = '|';

/**
 * One bullet, before it is a conversation.
 *
 * Kept flat with its own depth rather than nested on the way in, because the
 * nesting is the hard part and doing it in one place afterwards is easier to
 * be sure of than doing it while scanning.
 */
interface Said {
  kind: 'them' | 'you' | 'opens';
  text: string;
  depth: number;
  line: number;
  children: Said[];
}

/**
 * Both languages, from one line.
 *
 * No pipe means the same words in both, which is what a proper noun wants:
 * `Blaha Lujza tér` is what the place is called, not a phrase to translate.
 */
function bothWays(text: string, line: number): Words {
  const at = text.indexOf(SPLIT);
  if (at < 0) return { en: text.trim(), hu: text.trim() };
  const en = text.slice(0, at).trim();
  const hu = text.slice(at + SPLIT.length).trim();
  if (!en || !hu) throw new Error(`DIALOGUE.md line ${line}: one side of the pipe is empty`);
  return { en, hu };
}

/** Every bullet in a section, nested by how far it is indented. */
function nest(lines: readonly Said[]): Said[] {
  const top: Said[] = [];
  const open: Said[] = [];
  for (const said of lines) {
    while (open.length > 0 && open[open.length - 1]!.depth >= said.depth) open.pop();
    const parent = open[open.length - 1];
    if (parent) parent.children.push(said);
    else top.push(said);
    open.push(said);
  }
  return top;
}

/** The one child of a kind, if there is one. */
const childOf = (said: Said, kind: Said['kind']): Said | undefined =>
  said.children.find((each) => each.kind === kind);

function toReply(said: Said): Reply {
  const then = childOf(said, 'them');
  const opens = childOf(said, 'opens');
  return {
    text: bothWays(said.text, said.line),
    ...(then ? { then: toTurn(then) } : {}),
    ...(opens ? { opens: opens.text.trim() } : {}),
  };
}

function toTurn(said: Said): Turn {
  const you = said.children.filter((each) => each.kind === 'you');
  const opens = childOf(said, 'opens');
  return {
    them: bothWays(said.text, said.line),
    ...(you.length > 0 ? { you: you.map(toReply) } : {}),
    ...(opens ? { opens: opens.text.trim() } : {}),
  };
}

/** What one `##` section came to: a conversation, or a monologue. */
export type Section = { kind: 'talk'; turn: Turn } | { kind: 'alone'; says: Words[] };

/**
 * Read a script. Exported so the notation can be tested on a few lines rather
 * than on the whole game, which is the difference between a test that says
 * what the rule is and one that says the file has not changed.
 */
export function readScript(text: string): Map<string, Section> {
  const found = new Map<string, Section>();
  let name: string | null = null;
  let bullets: Said[] = [];

  const close = () => {
    if (name === null) return;
    const nested = nest(bullets);
    const first = nested[0];
    // A section with no `them:` line is a monologue: he is alone and thinking
    // out loud, and there is nothing to choose. Which is the difference
    // stated rather than declared -- a beat between levels has nobody in it.
    if (first && bullets.every((said) => said.kind === 'you')) {
      found.set(name, { kind: 'alone', says: bullets.map((said) => bothWays(said.text, said.line)) });
    } else if (first) {
      if (first.kind !== 'them') {
        throw new Error(`DIALOGUE.md line ${first.line}: "${name}" starts with ${first.kind}, not them`);
      }
      found.set(name, { kind: 'talk', turn: toTurn(first) });
    }
    name = null;
    bullets = [];
  };

  // Inside a fenced block, nothing counts. The file explains its own notation
  // by showing it, and the example in the introduction was being read as a
  // conversation called "How to write one".
  let fenced = false;
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const heading = /^##\s+(.*?)\s*$/.exec(raw);
    if (heading) {
      close();
      name = heading[1]!;
      return;
    }
    // A single-hash heading is a part of the file rather than a section --
    // and it ends whatever section was open.
    if (/^#\s/.test(raw)) {
      close();
      return;
    }
    const bullet = /^(\s*)-\s+(them|you|opens):\s*(.*?)\s*$/.exec(raw);
    if (!bullet) return;
    if (name === null) return;
    bullets.push({
      kind: bullet[2] as Said['kind'],
      text: bullet[3]!,
      depth: bullet[1]!.length,
      line,
      children: [],
    });
  });
  close();
  return found;
}

const SCRIPT = readScript(script);

/**
 * A conversation, by the name of its heading.
 *
 * Throws rather than returning nothing. A level pointing at a conversation
 * that is not in the file is a level that cannot be finished, and the moment
 * to find that out is the moment the game is opened.
 */
export function conversation(name: string): Turn {
  const found = SCRIPT.get(name);
  if (!found || found.kind !== 'talk') {
    throw new Error(`DIALOGUE.md has no conversation called "${name}"`);
  }
  return found.turn;
}

/** And a monologue, likewise. Empty for a beat that is only a camera move. */
export function alone(name: string): Words[] {
  const found = SCRIPT.get(name);
  return found?.kind === 'alone' ? found.says : [];
}

/** Every heading in the file, for the tests that keep it and the levels honest. */
export const SPOKEN: readonly string[] = [...SCRIPT.keys()];
