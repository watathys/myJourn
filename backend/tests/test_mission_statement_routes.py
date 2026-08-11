
from app.api.dependencies import set_test_user_id
from fastapi.testclient import TestClient


def test_get_unset_mission_statement_returns_null(client: TestClient) -> None:
    user_id = client.post("/api/users").json()["id"]

    response = client.get(f"/api/users/{user_id}/mission-statement")

    assert response.status_code == 200
    assert response.json() == {
        "user_id": user_id,
        "statement_text": None,
        "updated_at": None,
    }


def test_put_mission_statement_accepts_missing_empty_and_null_text(client: TestClient) -> None:
    user_id = client.post("/api/users").json()["id"]
    endpoint = f"/api/users/{user_id}/mission-statement"

    missing = client.put(endpoint, json={})
    assert missing.status_code == 200
    assert missing.json()["statement_text"] is None

    empty = client.put(endpoint, json={"statement_text": ""})
    assert empty.status_code == 200
    assert empty.json()["statement_text"] == ""

    null = client.put(endpoint, json={"statement_text": None})
    assert null.status_code == 200
    assert null.json()["statement_text"] is None


def test_get_and_put_mission_statement_require_an_existing_user(client: TestClient) -> None:
    set_test_user_id("missing-user")
    endpoint = "/api/users/missing-user/mission-statement"

    get_response = client.get(endpoint)
    put_response = client.put(endpoint, json={"statement_text": "Anything"})

    assert get_response.status_code == 404
    assert put_response.status_code == 404
