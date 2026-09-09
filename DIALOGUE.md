# The script

Every word anybody says in this game. **This file is the source** — the game
parses it at load, so editing a line here changes the line in the game. There
is no copy of it in the code.

## How to write one

Each `##` heading is one conversation, named exactly as the levels refer to
it. Inside, a nested bullet list is the shape of the exchange:

```
- them: What they say | Amit mondanak
  - you: One thing you can say back | Amit mondhatsz rá
    - them: And their answer | És a válaszuk
      - opens: Temető
  - you: Another thing you can say | Vagy amit mondhatsz
    - opens: Temető
```

- `them:` — a line the other bird says.
- `you:` — a reply the player can pick. Several at the same indent are the
  choices on offer; they are numbered on screen in the order written here.
- `opens:` — **the action**. This branch ends the conversation and hands over
  to the level or the scene named. Leave it off and the branch simply ends.
- `EN | HU` — English before the pipe, Hungarian after. Leave the pipe off and
  the same words are used in both, which is what a proper noun wants. A line
  cannot itself contain a pipe.
- Indent by two spaces per step. Anything that is not a bullet — a paragraph
  like this one — is a note, and the game ignores it.

A section with no `them:` line at all is a **monologue**: he is alone and
thinking out loud, and the lines are said one after the other with nothing to
choose. Those are named after the scene they belong to.

To add a line, add a bullet. To add a choice, add a `you:` beside another
`you:`. To make a branch end the level, put `opens:` under its last line.

---

## Heading out

The first thing anyone says in the game: the mate on the home tree, the egg
under her, and the errand that is the reason he leaves at all. The level it
belongs to is won the moment it starts, so this carries the whole of it. One
branch agrees and ends; the other offers to swap places, is turned down, and
ends on his word — which is the first thing in the game that shows a reply can
go somewhere rather than merely be chosen.

- them: I am starving. Could you get some food from Teleki tér? | Éhen halok. Hoznál kaját a Teleki térről?
  - you: Yes, sure! | Persze, megyek!
    - them: See you! | Szia!
      - opens: Temető
  - you: I would watch the egg, while you go! | Inkább én ülök a tojáson, menj te!
    - them: I'd rather stay | Inkább maradok
      - you: Okay. | Jól van.
        - opens: Temető

## The trapper

The one out west, and the first news of the story since the empty nest. Five
levels of looking end here. He has asked at three squares and found nobody,
and what he gets is not his mate — it is a direction: somebody takes birds,
and he is on the top of a big house.

No branches. Everything before this offers the player a choice of reply
because the choice is the beat; here the beat is being *told* something, and a
fork would be offering to not be told it.

- them: Hey mate! | Szia, haver!
  - you: I am looking for my girl | A páromat keresem
    - them: Good luck with that! | Sok szerencsét hozzá!
      - you: She has gone missing while I was away! | Eltűnt, amíg oda voltam!
        - them: There is a crazy person, a trapper, captures birds! On the top of a big house! Go look there! | Van itt egy őrült, egy madarász, madarakat fogdos! Egy nagy ház tetején! Nézz körül ott!
          - you: I go quick! | Rohanok!
            - opens: up to the roofs

## Caught

Through the bars, at the end of the search. The hinge of the whole story and
it is two lines, because it is not a conversation — it is the moment he finds
her, and neither of them has anything to work out. She says what happened and
he says what he is going to do about it, and then he leaves to do it.

He can reach her here, unlike at the end: the cage is between them and it is
*meant* to be. Standing next to somebody you cannot get to is the point of the
level.

- them: The trapper got me! | Elkapott a madarász!
  - you: Wait, I will bring some help! | Várj, hozok segítséget!
    - opens: Fiumei út

## The ask

On the roof of a moving wagon. The shortest conversation in the game and the
one the story has been going towards: he has found the birds, and what he
needs from them is that they come. Three lines, no branches, and the middle
one is the whole plot said out loud for the first time.

- them: Eh? | Na?
  - you: You need to help me, a crazy person kidnapped my girl! | Segítsetek, egy őrült elrabolta a páromat!
    - them: Let's go! | Gyerünk!
      - opens: Coming on strong

## Saved

On the roof, with the bars on the floor around them. The shortest one in the
game after the ask, and it is meant to be: the thing that had to happen has
happened, and the beat is that they are both still here. Anything longer would
be the game explaining its own ending.

It cannot be reached until the cage is open, so by the time either of them
says anything the player has watched thirty birds take it apart.

- them: You saved me! | Megmentettél!
  - you: I am so happy you are alive! | Úgy örülök, hogy élsz!
    - opens: Everafter

---

# Alone

The beats between levels, where he is standing somewhere with nobody to talk
to. Each is named after the scene it belongs to.

## a full belly

Standing on the concrete at Teleki tér with what he came for.

- you: My belly is full, time to fly home! | Tele a begyem, irány haza!

## flying home

Landing on the branch with a full belly, and finding the nest empty.

- you: OMG! Where did she go? | Jaj ne! Hová tűnt?
- you: Maybe she is on Mátyás tér. | Talán a Mátyás téren van.

## nobody at Mátyás tér

- you: She is not here. | Nincs itt.
- you: Maybe on Jani Pali tér. | Talán a Jani Pali téren.

## nobody at Jani Pali tér

- you: She is not here! | Itt sincs!
- you: Maybe on Blaha! | Talán a Blahán!
