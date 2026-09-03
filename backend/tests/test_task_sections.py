"""Tests for color-coded task sections."""

from __future__ import annotations

from app.models import User
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def _create_task(client: TestClient, user_id: str, text: str) -> dict:
    resp = client.post(f"/api/users/{user_id}/tasks", json={"goal_text": text})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_section_crud_and_reorder(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    # Create two sections
    resp1 = client.post(
        f"/api/users/{user.id}/sections",
        json={"name": "Biology 101", "color": "sky"},
    )
    assert resp1.status_code == 201, resp1.text
    s1 = resp1.json()
    assert s1["name"] == "Biology 101"
    assert s1["color"] == "sky"

    resp2 = client.post(
        f"/api/users/{user.id}/sections",
        json={"name": "Calculus", "color": "amber"},
    )
    assert resp2.status_code == 201
    s2 = resp2.json()

    # List sections (creation order)
    resp_get = client.get(f"/api/users/{user.id}/sections")
    assert resp_get.status_code == 200
    sections = resp_get.json()
    assert [s["id"] for s in sections] == [s1["id"], s2["id"]]

    # Rename + recolor
    resp_patch = client.patch(
        f"/api/sections/{s1['id']}",
        json={"user_id": user.id, "name": "Bio 101", "color": "forest"},
    )
    assert resp_patch.status_code == 200
    updated = resp_patch.json()
    assert updated["name"] == "Bio 101"
    assert updated["color"] == "forest"

    # Reorder sections
    resp_reorder = client.patch(
        f"/api/users/{user.id}/sections/reorder",
        json={"user_id": user.id, "ordered_ids": [s2["id"], s1["id"]]},
    )
    assert resp_reorder.status_code == 200
    reordered = resp_reorder.json()
    assert [s["id"] for s in reordered] == [s2["id"], s1["id"]]

    # Delete a section
    resp_del = client.request(
        "DELETE", f"/api/sections/{s1['id']}", json={"user_id": str(user.id)}
    )
    assert resp_del.status_code == 204

    resp_get_after = client.get(f"/api/users/{user.id}/sections")
    assert [s["id"] for s in resp_get_after.json()] == [s2["id"]]


def test_task_section_assignment_and_detach(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    section = client.post(
        f"/api/users/{user.id}/sections",
        json={"name": "Chemistry", "color": "clay"},
    ).json()

    # Create a task directly inside the section
    task = client.post(
        f"/api/users/{user.id}/tasks",
        json={"goal_text": "Read chapter 4", "section_id": section["id"]},
    ).json()
    assert task["section_id"] == section["id"]

    # Move it out (unassign) via PATCH
    moved = client.patch(
        f"/api/tasks/{task['id']}",
        json={"user_id": user.id, "section_id": None},
    ).json()
    assert moved["section_id"] is None

    # Move it into the section again
    moved_back = client.patch(
        f"/api/tasks/{task['id']}",
        json={"user_id": user.id, "section_id": section["id"]},
    ).json()
    assert moved_back["section_id"] == section["id"]

    # Invalid section id is rejected
    bad = client.patch(
        f"/api/tasks/{task['id']}",
        json={"user_id": user.id, "section_id": "does-not-exist"},
    )
    assert bad.status_code == 422


def test_deleting_section_detaches_tasks(client: TestClient, session: Session) -> None:
    user = User()
    session.add(user)
    session.commit()

    section = client.post(
        f"/api/users/{user.id}/sections",
        json={"name": "History", "color": "violet"},
    ).json()
    task = client.post(
        f"/api/users/{user.id}/tasks",
        json={"goal_text": "Write essay", "section_id": section["id"]},
    ).json()

    client.request("DELETE", f"/api/sections/{section['id']}", json={"user_id": str(user.id)})

    tasks = client.get(f"/api/users/{user.id}/tasks").json()
    assert any(t["id"] == task["id"] and t["section_id"] is None for t in tasks)
