/**
 * What two pigeons say to each other when one has walked up to the other.
 *
 * A tree, because a conversation is one: they say something, you pick from
 * what you might say back, and what they say next depends on which you chose.
 * One reply or several; the branch ends when there is nothing left to say.
 *
 * The script here is a placeholder and is the same at the end of every level.
 * It is written as data so that replacing it is writing different data.
 */

/**
 * The level an ending hands over, by name.
 *
 * A conversation is how one level becomes the next. An ending that carries a
 * name says "you are on that level now" -- and says only that: the bird stays
 * exactly where it is standing, on the roof or the branch it walked up to
 * somebody on, and flies out of there under its own power. The alternative,
 * which is what every other level still does, is to be picked up and released
 * over the next one.
 *
 * Written as a name rather than an index, like everything else in this game
 * that points at a level or a landmark: an index is a thing you can get wrong
 * silently, and a name that matches nothing is a failing test.
 *
 * It is on the ending rather than on the level because different answers can
 * lead different places. Nothing does that yet, and the shape is what makes
 * it possible to.
 */
export type Opens = string;

/** Something the player can say, and what it leads to. */
export interface Reply {
  text: string;
  /** What they say to that. Absent ends the exchange on your word. */
  then?: Turn;
  /** The level this hands over, if it is an ending that does. */
  opens?: Opens;
}

/** Something the other pigeon says, and what you can say back. */
export interface Turn {
  them: string;
  /** Absent or empty ends the exchange on theirs. */
  you?: readonly Reply[];
  /** The level this hands over, if it is an ending that does. */
  opens?: Opens;
}

/** A line already said, for the panel to show. */
export interface Said {
  who: 'them' | 'you';
  text: string;
}

/**
 * A conversation in progress.
 *
 * Carries what has been said as well as where it has got to, because a
 * conversation you can only see the last line of is a conversation you have
 * to remember rather than read.
 */
export interface Exchange {
  said: readonly Said[];
  /** What the player can say now. Empty when there is nothing left. */
  replies: readonly Reply[];
  /**
   * The level this conversation has handed over, once it is over.
   *
   * Taken off whichever line ended it -- hers if she had the last word, yours
   * if you did -- so that where a branch *ends* decides, rather than which
   * reply started it.
   */
  opens?: Opens;
}

/**
 * Whether a set of replies is the end of it, and what that ending hands over.
 *
 * Spread rather than assigned, because an exchange that opens nothing has no
 * `opens` at all rather than an `opens` that is undefined.
 */
const ending = (ends: boolean, opens: Opens | undefined) =>
  ends && opens !== undefined ? { opens } : {};

/**
 * A monologue: somebody with nobody to say it to.
 *
 * A special case of a conversation rather than a thing of its own, which is
 * both true and the reason it is one line of code: it is an exchange in which
 * every line is the hero's and there is nothing to say back. Everything that
 * already knows how to show a conversation shows it -- his colour, the same
 * card in the same place -- and everything that asks whether a conversation
 * is finished gets "yes", because a man talking to himself is never waiting
 * for an answer.
 *
 * The alternative was a second panel with its own rules, showing the same
 * kind of thing in a different place, and that is how a game ends up with two
 * ways of putting words on the screen.
 */
export const alone = (...lines: readonly string[]): Exchange => ({
  said: lines.map((text) => ({ who: 'you', text })),
  replies: [],
});

/** Open with their line. */
export function begin(turn: Turn): Exchange {
  const replies = turn.you ?? [];
  return {
    said: [{ who: 'them', text: turn.them }],
    replies,
    ...ending(replies.length === 0, turn.opens),
  };
}

/** Whether there is anything left to say. */
export const isOver = (exchange: Exchange): boolean => exchange.replies.length === 0;

/**
 * Say the `choice`th thing on offer, counting from one.
 *
 * A number that is not on offer leaves the conversation where it was. Saying
 * nothing is a fair response to being asked to pick between two things and
 * pressing a third.
 */
export function reply(exchange: Exchange, choice: number): Exchange {
  const said = exchange.replies[choice - 1];
  if (!said) return exchange;

  const spoken: Said[] = [...exchange.said, { who: 'you', text: said.text }];
  if (!said.then) return { said: spoken, replies: [], ...ending(true, said.opens) };

  spoken.push({ who: 'them', text: said.then.them });
  const replies = said.then.you ?? [];
  return { said: spoken, replies, ...ending(replies.length === 0, said.then.opens) };
}

/**
 * The placeholder, used at the end of every level until there is a story.
 *
 * Both branches end after one exchange, which is the shape the real ones will
 * have too even when they are longer: they speak, you choose, they answer.
 */
/**
 * The first thing anyone says in the game: the mate on the home tree, the egg
 * under her, and the errand that is the reason he leaves at all.
 *
 * The level it belongs to is won the moment it starts, so this carries the
 * whole of it. One branch agrees and ends; the other offers to swap places,
 * is turned down, and ends on his word -- which is the first thing in the
 * game that shows a reply can go somewhere rather than merely be chosen.
 */
export const HEADING_OUT: Turn = {
  them: 'Could you get some food from Teleki tér?',
  you: [
    { text: 'Yes, sure!', then: { them: 'See you!', opens: 'Temető' } },
    {
      text: 'I would watch the egg, while you go!',
      then: {
        them: "I'd rather stay",
        you: [{ text: 'Okay.', opens: 'Temető' }],
      },
    },
  ],
};

export const GREETING: Turn = {
  them: "It's good to see you!",
  you: [
    { text: 'You too!', then: { them: 'Good luck on your quest!' } },
    { text: 'It was not easy!', then: { them: 'Nothing is easy!' } },
  ],
};
