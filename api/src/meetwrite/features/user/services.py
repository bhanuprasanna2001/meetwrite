"""Local-user persistence."""

from sqlmodel import Session

from meetwrite.db.models import User

LOCAL_USER_ID = 1


def ensure_local_user(session: Session) -> User:
    user = session.get(User, LOCAL_USER_ID)
    if user is None:
        user = User(id=LOCAL_USER_ID)
        session.add(user)
        session.flush()
    return user


def save_name(session: Session, user: User, name: str) -> User:
    user.name = name
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
