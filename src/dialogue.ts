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

/** Something the player can say, and what it leads to. */
export interface Reply {
  text: string;
  /** What they say to that. Absent ends the exchange on your word. */
  then?: Turn;
}

/** Something the other pigeon says, and what you can say back. */
export interface Turn {
  them: string;
  /** Absent or empty ends the exchange on theirs. */
  you?: readonly Reply[];
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
}

/** Open with their line. */
export function begin(turn: Turn): Exchange {
  return { said: [{ who: 'them', text: turn.them }], replies: turn.you ?? [] };
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
  if (!said.then) return { said: spoken, replies: [] };

  spoken.push({ who: 'them', text: said.then.them });
  return { said: spoken, replies: said.then.you ?? [] };
}

/**
 * The placeholder, used at the end of every level until there is a story.
 *
 * Both branches end after one exchange, which is the shape the real ones will
 * have too even when they are longer: they speak, you choose, they answer.
 */
/**
 * The first thing anyone says in the game: the mate on the home tree, the egg
 * under her, and the reason the hero is about to leave.
 *
 * The level it belongs to is won the moment it starts, so this carries the
 * whole of it. Both branches end after one exchange, like the placeholder,
 * because the shape is right even when the words are real: she speaks, you
 * choose, she answers.
 */
export const LEAVING: Turn = {
  them: 'Go on, then. The egg and I will still be here.',
  you: [
    {
      text: "I'll be back before it hatches.",
      then: { them: "You'd better be. Fly high, and keep the river on your left." },
    },
    {
      text: "I don't want to go.",
      then: { them: 'Nor do I want you to. Go anyway -- and come home.' },
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
