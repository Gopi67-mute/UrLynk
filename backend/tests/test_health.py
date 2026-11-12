from fastapi.testclient import TestClient


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"]


def test_database_health_reports_unavailable_without_details(client: TestClient) -> None:
    # The test settings point at a port nothing listens on.
    response = client.get("/health/db")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}
    body = response.text.lower()
    for leaked in ("127.0.0.1", "postgres", "password", "test:test", "unreachable", "psycopg"):
        assert leaked not in body


def test_unknown_route_uses_error_shape(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"] == response.headers["X-Request-ID"]


def test_wrong_method_uses_error_shape(client: TestClient) -> None:
    response = client.post("/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_docs_are_hidden_in_production(verifier) -> None:
    from conftest import make_settings

    from app.main import create_app

    app = create_app(make_settings(app_env="production"), token_verifier=verifier)
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
