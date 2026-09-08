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

import type { Words } from './i18n';

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
  text: Words;
  /** What they say to that. Absent ends the exchange on your word. */
  then?: Turn;
  /** The level this hands over, if it is an ending that does. */
  opens?: Opens;
}

/** Something the other pigeon says, and what you can say back. */
export interface Turn {
  them: Words;
  /** Absent or empty ends the exchange on theirs. */
  you?: readonly Reply[];
  /** The level this hands over, if it is an ending that does. */
  opens?: Opens;
}

/** A line already said, for the panel to show. */
export interface Said {
  who: 'them' | 'you';
  /**
   * Both languages, rather than the one that was current when it was said.
   *
   * So that swapping the language mid-conversation swaps what is already on
   * the card as well as what comes next -- a panel half in each would be a
   * worse answer than not being able to swap at all.
   */
  text: Words;
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
export const alone = (...lines: readonly Words[]): Exchange => ({
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
  them: { en: 'Could you get some food from Teleki tér?', hu: 'Hoznál kaját a Teleki térről?' },
  you: [
    {
      text: { en: 'Yes, sure!', hu: 'Persze, megyek!' },
      then: { them: { en: 'See you!', hu: 'Szia!' }, opens: 'Temető' },
    },
    {
      text: {
        en: 'I would watch the egg, while you go!',
        hu: 'Inkább én ülök a tojáson, menj te!',
      },
      then: {
        them: { en: "I'd rather stay", hu: 'Inkább maradok' },
        you: [{ text: { en: 'Okay.', hu: 'Jól van.' }, opens: 'Temető' }],
      },
    },
  ],
};

/**
 * Through the bars, at the end of the search.
 *
 * The hinge of the whole story and it is two lines, because it is not a
 * conversation -- it is the moment he finds her, and neither of them has
 * anything to work out. She says what happened and he says what he is going
 * to do about it, and then he leaves to do it.
 *
 * He can reach her here, unlike at the end: the cage is between them and it
 * is *meant* to be. Standing next to somebody you cannot get to is the point
 * of the level.
 */
export const CAUGHT: Turn = {
  them: { en: 'The trapper got me!', hu: 'Elkapott a madarász!' },
  you: [
    {
      text: { en: 'Wait, I will bring some help!', hu: 'Várj, hozok segítséget!' },
      opens: 'Fiumei út',
    },
  ],
};

/**
 * The one out west, and the first news of the story since the empty nest.
 *
 * Five levels of looking end here. He has asked at three squares and found
 * nobody, and what he gets is not his mate -- it is a direction: somebody
 * takes birds, and he is on the top of a big house.
 *
 * No branches. Everything before this offers the player a choice of reply
 * because the choice is the beat; here the beat is being told something, and
 * a fork would be offering to not be told it. So each turn has one thing to
 * say and saying it is what moves on.
 */
export const THE_TRAPPER: Turn = {
  them: { en: 'Hey mate!', hu: 'Szia, haver!' },
  you: [
    {
      text: { en: 'I am looking for my girl', hu: 'A páromat keresem' },
      then: {
        them: { en: 'Good luck with that!', hu: 'Sok szerencsét hozzá!' },
        you: [
          {
            text: {
              en: 'She has gone missing while I was away!',
              hu: 'Eltűnt, amíg oda voltam!',
            },
            then: {
              them: {
                en:
                  'There is a crazy person, a trapper, captures birds! ' +
                  'On the top of a big house! Go look there!',
                hu:
                  'Van itt egy őrült, egy madarász, madarakat fogdos! ' +
                  'Egy nagy ház tetején! Nézz körül ott!',
              },
              you: [
                { text: { en: 'I go quick!', hu: 'Rohanok!' }, opens: 'up to the roofs' },
              ],
            },
          },
        ],
      },
    },
  ],
};

/**
 * The ask, on the roof of a moving wagon.
 *
 * The shortest conversation in the game and the one the story has been going
 * towards: he has found the birds, and what he needs from them is that they
 * come. Three lines, no branches, and the middle one is the whole plot said
 * out loud for the first time.
 */
export const THE_ASK: Turn = {
  them: { en: 'Eh?', hu: 'Na?' },
  you: [
    {
      text: {
        en: 'You need to help me, a crazy person kidnapped my girl!',
        hu: 'Segítsetek, egy őrült elrabolta a páromat!',
      },
      then: { them: { en: "Let's go!", hu: 'Gyerünk!' }, opens: 'Coming on strong' },
    },
  ],
};

/**
 * On the roof, with the bars on the floor around them.
 *
 * The shortest one in the game after the ask, and it is meant to be: the
 * thing that had to happen has happened, and the beat is that they are both
 * still here. Anything longer would be the game explaining its own ending.
 *
 * It cannot be reached until the cage is open -- see the rescue -- so by the
 * time either of them says anything the player has watched thirty birds walk
 * up to it and take it apart.
 */
export const SAVED: Turn = {
  them: { en: 'You saved me!', hu: 'Megmentettél!' },
  you: [
    {
      text: { en: 'I am so happy you are alive!', hu: 'Úgy örülök, hogy élsz!' },
      opens: 'Everafter',
    },
  ],
};

