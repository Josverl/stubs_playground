from pathlib import Path


pytest_plugins = ["tests.fixtures"]


def pytest_collection_modifyitems(items):
    test_root = Path(__file__).parent
    for item in items:
        if Path(item.path).is_relative_to(test_root):
            item.add_marker("component")
