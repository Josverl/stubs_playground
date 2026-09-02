project = "MicroPython Stubs Playground"
author = "Jos Verlinde"
copyright = "2026, Jos Verlinde"

extensions = [
    "myst_parser",
    "sphinxcontrib.mermaid",
]
source_suffix = {
    ".md": "markdown",
    ".rst": "restructuredtext",
}
master_doc = "index"
exclude_patterns = [
    "_build",
    "Archive",
    "component-reusability-plan.md",
    "improvements.md",
]

html_theme = "furo"
html_title = "MicroPython Stubs Playground"

myst_enable_extensions = [
    "colon_fence",
    "deflist",
]
myst_heading_anchors = 3
myst_fence_as_directive = ["mermaid"]
