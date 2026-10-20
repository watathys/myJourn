from app.models import User
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def test_pull_before_push_is_404(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    assert client.get(f"/api/users/{user.id}/task-sync").status_code == 404


def test_push_then_pull_round_trips_and_overwrites(
    client: TestClient, session: Session
) -> None:
    user = User()
    session.add(user)
    session.commit()
    url = f"/api/users/{user.id}/task-sync"

    first = {"tasks": [{"id": "a", "goal_text": "One"}], "weekly_goals": [{"id": "g"}]}
    assert client.put(url, json=first).status_code == 200
    pulled = client.get(url).json()
    assert pulled["tasks"] == first["tasks"]
    assert pulled["weekly_goals"] == first["weekly_goals"]

    second = {"tasks": [], "weekly_goals": []}
    assert client.put(url, json=second).status_code == 200
    assert client.get(url).json()["tasks"] == []
