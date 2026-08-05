from pathlib import Path

import pytest


pytest_plugins = ["tests.fixtures"]


@pytest.fixture(scope="session")
def live_server(project_server):
    """Base URL for the playground application."""
    return f"{project_server}/apps/playground"


def pytest_collection_modifyitems(items):
    test_root = Path(__file__).parent
    for item in items:
        if Path(item.path).is_relative_to(test_root):
            item.add_marker("app")
