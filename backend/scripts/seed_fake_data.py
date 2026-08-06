"""seed_fake_data.py — fill the DB with believable practice sessions so the analytics dashboard has something to show before real usage exists."""
import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from services.db_models import User, Conversation, Message  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(BACKEND_DIR, "data", "seed_manifest.json")

FALLBACK_LABELS = ["neutral", "happy", "sad", "angry", "fearful", "disgust", "surprised"]

MODES = ["professional", "psy", "sport"]

TITLES = {
    "professional": [
        "Salary negotiation rehearsal", "Standing my ground in reviews",
        "Pitching to the leadership team", "Saying no to extra scope",
        "First 90 days as a lead", "Handling a hostile stakeholder",
        "Interview: tell me about yourself", "Asking for a promotion",
    ],
    "psy": [
        "Winding down after a hard week", "Talking through the burnout",
        "When I freeze in meetings", "Comparing myself to everyone",
        "Sunday night dread", "Setting a boundary with family",
        "Sitting with the anxiety", "What I actually want",
    ],
    "sport": [
        "Pre-match nerves", "Getting back after the injury",
        "Talking to the coach", "Focus under pressure",
        "Losing streak reset", "Race-day routine",
    ],
}

USER_LINES = [
    "I keep second-guessing myself right before I speak.",
    "Honestly I think I handled that better than last time.",
    "When they pushed back I just froze and agreed with them.",
    "I practised what I wanted to say but it came out wrong.",
    "I don't want to sound arrogant, but I did do the work.",
    "It felt like everyone in the room already had their mind made up.",
    "I noticed I was rushing, so I slowed down and it helped.",
    "I'm tired of apologising for taking up space.",
    "There's this voice telling me I'm going to be found out.",
    "I said the number out loud and didn't flinch this time.",
    "I get about halfway through and then lose my thread.",
    "Something shifted this week — it felt lighter.",
]

COACH_LINES = [
    "What do you notice in your body right at that moment?",
    "That's a real change from where you started. What made it possible?",
    "Let's slow that down — what did you want to say instead?",
    "You're describing a pattern. Where else does it show up?",
    "Say it again, but this time without softening it.",
    "What would it cost you to hold that boundary?",
    "That sounds like preparation paying off, not luck.",
    "Who taught you that taking up space was a problem?",
]

ARCS = [
    ["fearful", "fearful", "neutral", "neutral", "happy"],
    ["neutral", "sad", "sad", "neutral", "neutral"],
    ["angry", "angry", "neutral", "sad", "neutral"],
    ["neutral", "neutral", "happy", "happy"],
    ["sad", "neutral", "fearful", "neutral", "happy"],
    ["surprised", "neutral", "happy", "happy"],
    ["fearful", "angry", "neutral", "neutral"],
    ["neutral", "disgust", "angry", "neutral", "sad"],
]


def _load_manifest() -> dict:
    if not os.path.exists(MANIFEST):
        return {"conversation_ids": [], "message_ids": []}
    try:
        with open(MANIFEST, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"conversation_ids": [], "message_ids": []}


def _save_manifest(data: dict) -> None:
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def clear(db) -> int:
    """Delete only rows this script created, newest first."""
    man = _load_manifest()
    ids = man.get("conversation_ids", [])
    if not ids:
        print("Nothing to clear — manifest is empty.")
        return 0

    n_msgs = db.query(Message).filter(Message.conversation_id.in_(ids)).delete(
        synchronize_session=False
    )
    n_convs = db.query(Conversation).filter(Conversation.id.in_(ids)).delete(
        synchronize_session=False
    )
    db.commit()
    _save_manifest({"conversation_ids": [], "message_ids": []})
    print(f"Removed {n_convs} seeded conversation(s) and {n_msgs} message(s).")
    return n_convs


def seed(db, user: User, sessions: int, weeks: int, seed_value: int) -> None:
    rng = random.Random(seed_value)

    try:
        from services.emotion_model import EMOTION_LABELS as labels
    except Exception:
        labels = FALLBACK_LABELS

    man = _load_manifest()
    now = datetime.now(timezone.utc)

    created = 0
    for i in range(sessions):
        frac = (sessions - 1 - i) / max(sessions - 1, 1)
        days_ago = frac * weeks * 7 + rng.uniform(-1.2, 1.2)
        days_ago = max(days_ago, 0.05)
        started = now - timedelta(days=days_ago, hours=rng.uniform(0, 6))

        mode = rng.choice(MODES)
        conv = Conversation(
            user_id=user.id,
            mode=mode,
            title=rng.choice(TITLES[mode]),
            video_enabled=rng.random() < 0.4,
            created_at=started,
        )
        db.add(conv)
        db.flush()

        arc = rng.choice(ARCS)
        n_turns = len(arc)

        base = 4.6 * frac + 1.1 * (1 - frac)

        t = started
        for turn in range(n_turns):
            t += timedelta(seconds=rng.uniform(25, 70))

            measured = rng.random() > 0.15
            fillers = max(0, int(round(rng.gauss(base, 1.1)))) if measured else None
            emotion = arc[turn] if measured else None
            if measured and rng.random() < 0.12:
                emotion = rng.choice(labels)

            um = Message(
                conversation_id=conv.id,
                role="user",
                content=rng.choice(USER_LINES),
                emotion=emotion,
                filler_count=fillers,
                created_at=t,
            )
            db.add(um)
            db.flush()
            man["message_ids"].append(um.id)

            t += timedelta(seconds=rng.uniform(3, 9))
            am = Message(
                conversation_id=conv.id,
                role="assistant",
                content=rng.choice(COACH_LINES),
                created_at=t,
            )
            db.add(am)
            db.flush()
            man["message_ids"].append(am.id)

        man["conversation_ids"].append(conv.id)
        created += 1
        print(f"  [{started:%Y-%m-%d}] {mode:<12} {conv.title[:38]:<38} {n_turns} turns")

    db.commit()
    _save_manifest(man)
    print(f"\nSeeded {created} conversation(s) for {user.email}.")
    print(f"Manifest: {MANIFEST}")
    print("Undo with:  python backend/scripts/seed_fake_data.py --clear")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", help="user to attach the sessions to")
    ap.add_argument("--sessions", type=int, default=14)
    ap.add_argument("--weeks", type=int, default=10, help="spread sessions over N weeks back")
    ap.add_argument("--seed", type=int, default=7, help="RNG seed, for reproducible data")
    ap.add_argument("--clear", action="store_true", help="remove previously seeded rows and exit")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.clear:
            clear(db)
            return 0

        if not args.email:
            print("--email is required (or use --clear). Known users:")
            for u in db.query(User).all():
                print(f"  {u.email}")
            return 2

        user = db.query(User).filter(User.email == args.email.lower()).first()
        if user is None:
            print(f"No user with email {args.email!r}. Known users:")
            for u in db.query(User).all():
                print(f"  {u.email}")
            return 2

        print(f"Seeding {args.sessions} sessions over {args.weeks} weeks for {user.email}:")
        seed(db, user, args.sessions, args.weeks, args.seed)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
