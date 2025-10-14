import pytest
import requests

def test_home():
    response = requests.get("http://localhost:8001/api/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "version" in data
    assert data["message"] == "AI Meeting Assistant API"
    assert data["version"] == "1.0.0"
