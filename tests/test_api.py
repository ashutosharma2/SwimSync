"""The HTTP layer: headers, status codes, and what a swimmer sees."""

from fastapi.testclient import TestClient

from app.main import app
from conftest import make_session, new_key

client = TestClient(app)


def post_booking(session_id, swimmer="alice", key=None):
    return client.post(
        f"/sessions/{session_id}/bookings",
        headers={"X-Swimmer-Id": swimmer, "Idempotency-Key": key or new_key()},
    )


def test_sessions_show_remaining_places():
    session = make_session(capacity=3, name="Lunchtime swim")
    post_booking(session)

    listed = client.get("/sessions").json()

    assert [(s["name"], s["capacity"], s["remaining"]) for s in listed] == [("Lunchtime swim", 3, 2)]


def test_booking_returns_201_then_200_on_retry():
    session = make_session(capacity=3)
    key = new_key()

    first = post_booking(session, key=key)
    retry = post_booking(session, key=key)

    assert (first.status_code, retry.status_code) == (201, 200)
    assert first.json() == retry.json()


def test_booking_needs_both_headers():
    session = make_session(capacity=3)

    no_key = client.post(f"/sessions/{session}/bookings", headers={"X-Swimmer-Id": "alice"})
    bad_key = client.post(f"/sessions/{session}/bookings", headers={"X-Swimmer-Id": "alice", "Idempotency-Key": "123"})
    no_swimmer = client.post(f"/sessions/{session}/bookings", headers={"Idempotency-Key": new_key()})

    assert (no_key.status_code, bad_key.status_code, no_swimmer.status_code) == (422, 422, 422)


def test_my_bookings_shows_current_status():
    session = make_session(capacity=3, name="Evening swim")
    made = post_booking(session).json()
    client.post(f"/bookings/{made['booking_id']}/cancel", headers={"X-Swimmer-Id": "alice"})
    post_booking(session)

    mine = client.get("/me/bookings", headers={"X-Swimmer-Id": "alice"}).json()

    assert [(b["session_name"], b["status"]) for b in mine] == [("Evening swim", "cancelled"), ("Evening swim", "confirmed")]
    assert client.get("/me/bookings", headers={"X-Swimmer-Id": "bob"}).json() == []


def test_cancel_endpoint_is_safe_to_retry():
    session = make_session(capacity=1)
    made = post_booking(session).json()
    path = f"/bookings/{made['booking_id']}/cancel"

    first = client.post(path, headers={"X-Swimmer-Id": "alice"})
    retry = client.post(path, headers={"X-Swimmer-Id": "alice"})

    assert (first.status_code, retry.status_code) == (200, 200)
    assert (first.json()["already_cancelled"], retry.json()["already_cancelled"]) == (False, True)
