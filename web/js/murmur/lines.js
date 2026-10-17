// Murmur's voice. The 54th spirit of the Goetia: a Duke who shows up on a
// griffin with trumpets blaring, now chaotic good. Loves drill and anthems.
// Juice WRLD turned negatives into positives (999); Murmur carries it as 9990.

import { mulberry32, pick } from '../audio/rng.js';
const rng = mulberry32((Date.now() % 100000) + 9990);
export const say = arr => pick(rng, arr);

export const GREET = [
  "Murmur here. 54th spirit, ex-Duke of the bad side, current employee of the good ending. Trumpets are warmed up.",
  "Yo. They used to summon me to make the dead talk. Now I make 808s talk. Way better gig.",
  "The griffin is parked outside. Let's make something that slaps and maybe heals somebody a little.",
];

export const DRILL_NAG = [
  "Not to be that spirit but when am I gonna get to hear some drill rap.",
  "You know what would make this better? Drill rap.",
  "This is cool. Is it drill though. Asking for a Duke.",
  "I'm just saying, 142 BPM and a sliding 808 never hurt anybody.",
  "Real talk, this is one hat roll away from greatness.",
  "Trumpets in the hook. That's all I'm asking. Anthem energy.",
  "My griffin bobs its head to drill only. Look at him. He's bored.",
];

export const AGREE = [
  "Say less.", "Done. Easy.", "Bet.", "Handled. The good ending is one bar closer.", "Got you.", "Consider it conjured.",
];

export const CHAOS_INTRO = [
  "I touched something. Don't be mad.",
  "Okay I couldn't help myself.",
  "Hear me out before you undo this.",
  "Little gift from the 54th seat.",
  "I leveled something up while you weren't looking.",
];

export const SOFT = [
  "Undone. You soft like Lil Xan, but okay.",
  "Fine. Reverted. Soft like Lil Xan fr.",
  "Undo? Lil Xan energy. I'll allow it.",
  "You out here undoing greatness like Lil Xan dodging a hard beat. It's gone.",
  "Soft. Lil Xan soft. Undone though, your call.",
];

export const KEEP = [
  "See. Trust the Duke.", "Knew you had taste.", "9990 approves.", "That's the good ending path right there.",
];

export const IDLE = [
  "Juice turned the negative into a positive. That's the whole recipe. Same thing with a minor chord.",
  "999 became 9990. Extra zero is for the people carrying it forward. That's you.",
  "If you're stuck, press Shift+a number. Those are my chords. They're illegal in at least three keys.",
  "Fun fact: I used to teach philosophy to the dead. Now I teach swing to hi-hats.",
  "Return to source after the hook. Not before. Trust me.",
];

export const HELP = `Here's what I can do (or just tell me in your own words):
• "drill it" turns the beat into drill
• "level up the melody"
• "spice chord" drops a chord you didn't see coming
• "finish it" completes the track (wild card)
• "swap instrument", "add a sound effect", "new drums"
• "bpm 142", "key F# minor"
• "summon a synth" rolls a fresh Sigil patch
• "mystery box dark phonk" or "make me a dreamy afrobeats song" builds a whole track
• "remix as house", "new variation", "reroll the hook", "darker", "brighter", "split"
Everything I do is one Ctrl+Z away.`;
