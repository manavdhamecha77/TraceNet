"""Manage login accounts from the command line (run from backend/):

    python -m app.auth.users add <username> --role admin --name "Insp. A. Shah / Badge #1001"
    python -m app.auth.users list
    python -m app.auth.users passwd <username>
    python -m app.auth.users role <username> operator|admin
    python -m app.auth.users disable <username>      (and: enable <username>)

Passwords are prompted for (never passed on the command line) and stored as bcrypt hashes.
"""

from __future__ import annotations

import argparse
import getpass
import sys
import uuid

from app.auth.security import ROLES, hash_password
from app.db.models import Base, UserAccount
from app.db.session import SessionLocal, engine

MIN_PASSWORD_LENGTH = 8


def _ask_password() -> str:
    while True:
        first = getpass.getpass("Password: ")
        if len(first) < MIN_PASSWORD_LENGTH:
            print(f"Use at least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if getpass.getpass("Repeat password: ") != first:
            print("Passwords do not match.")
            continue
        return first


def _get(db, username: str) -> UserAccount:
    account = db.query(UserAccount).filter(UserAccount.username == username.lower()).first()
    if not account:
        sys.exit(f"No user '{username}'.")
    return account


def _admins_left(db, excluding: str) -> int:
    return db.query(UserAccount).filter(
        UserAccount.role == "admin", UserAccount.is_active == True, UserAccount.id != excluding  # noqa: E712
    ).count()


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.auth.users", description="Manage TraceNet login accounts.")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("add", help="create an account")
    add.add_argument("username")
    add.add_argument("--role", choices=ROLES, default="operator")
    add.add_argument("--name", help="display name stamped on records, e.g. 'J. Doe / Badge #4082'")
    sub.add_parser("list", help="list accounts")
    pw = sub.add_parser("passwd", help="set a new password")
    pw.add_argument("username")
    role = sub.add_parser("role", help="change role")
    role.add_argument("username")
    role.add_argument("new_role", choices=ROLES)
    for name in ("disable", "enable"):
        p = sub.add_parser(name)
        p.add_argument("username")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine, tables=[UserAccount.__table__])
    with SessionLocal() as db:
        if args.command == "add":
            username = args.username.strip().lower()
            if db.query(UserAccount).filter(UserAccount.username == username).first():
                sys.exit(f"User '{username}' already exists.")
            account = UserAccount(id=str(uuid.uuid4()), username=username, display_name=args.name or username,
                                  role=args.role, password_hash=hash_password(_ask_password()))
            db.add(account)
            db.commit()
            print(f"Created {args.role} '{username}'.")
        elif args.command == "list":
            for u in db.query(UserAccount).order_by(UserAccount.username).all():
                print(f"{u.username:20} {u.role:9} {'active' if u.is_active else 'DISABLED':9} {u.display_name}")
        elif args.command == "passwd":
            account = _get(db, args.username)
            account.password_hash = hash_password(_ask_password())
            db.commit()
            print(f"Password updated for '{account.username}'.")
        elif args.command == "role":
            account = _get(db, args.username)
            if account.role == "admin" and args.new_role != "admin" and _admins_left(db, account.id) == 0:
                sys.exit("Refusing: this is the last active Admin.")
            account.role = args.new_role
            db.commit()
            print(f"'{account.username}' is now {args.new_role}.")
        else:
            account = _get(db, args.username)
            if args.command == "disable" and account.role == "admin" and _admins_left(db, account.id) == 0:
                sys.exit("Refusing: this is the last active Admin.")
            account.is_active = args.command == "enable"
            db.commit()
            print(f"'{account.username}' {'enabled' if account.is_active else 'disabled'}.")


if __name__ == "__main__":
    main()
