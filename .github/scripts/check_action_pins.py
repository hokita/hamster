import re
import sys
from pathlib import Path

import yaml

USAGE = "usage: check_action_pins.py <workflows-dir>"

ALLOWED_USES = (
    re.compile(r"^[^/@\s:]+/[^/@\s:]+(/[^@\s]+)?@[0-9a-f]{40}\Z"),
    re.compile(r"^\./"),
    re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}\Z"),
)
COMMENT_START = re.compile(r"(?:^|(?<=\s))#")
COMMENTED_USES = re.compile(r"(?<![A-Za-z0-9_-])uses['\"]?\s*:")

EXIT_CLEAN = 0
EXIT_OFFENDERS = 1
EXIT_ERROR = 2


def printable(text):
    return str(text).encode("unicode_escape").decode("ascii")


def is_allowed(node):
    return isinstance(node, yaml.ScalarNode) and any(
        pattern.search(node.value) for pattern in ALLOWED_USES
    )


def describe(node):
    if isinstance(node, yaml.ScalarNode):
        return printable(node.value)
    return "<non-scalar>"


def uses_offenders(root):
    offenders = []
    visited = set()
    pending = [root]
    while pending:
        node = pending.pop()
        if id(node) in visited:
            continue
        visited.add(id(node))
        if isinstance(node, yaml.MappingNode):
            for key, value in node.value:
                if isinstance(key, yaml.ScalarNode) and key.value == "uses" and not is_allowed(value):
                    offenders.append((key.start_mark.line + 1, describe(value)))
                pending.extend((key, value))
        elif isinstance(node, yaml.SequenceNode):
            pending.extend(node.value)
    return offenders


def commented_uses_lines(text):
    lines = []
    for number, line in enumerate(text.splitlines(), start=1):
        comment = COMMENT_START.search(line)
        if comment and COMMENTED_USES.search(line, comment.start()):
            lines.append(number)
    return lines


def check_file(path):
    text = path.read_text(encoding="utf-8")
    offenders = []
    for document in yaml.compose_all(text, Loader=yaml.SafeLoader):
        if document is not None:
            offenders.extend(uses_offenders(document))
    offenders.extend((line, "commented-out uses") for line in commented_uses_lines(text))
    return sorted(offenders, key=lambda offender: offender[0])


def workflow_files(directory):
    return sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and path.name.lower().endswith((".yml", ".yaml"))
    )


def main(argv):
    if len(argv) != 1 or not Path(argv[0]).is_dir():
        print(USAGE, file=sys.stderr)
        return EXIT_ERROR
    directory = Path(argv[0])
    files = workflow_files(directory)
    if not files:
        print(f"check_action_pins.py: no .yml or .yaml files in {printable(directory)}", file=sys.stderr)
        return EXIT_ERROR

    status = EXIT_CLEAN
    for path in files:
        try:
            offenders = check_file(path)
        except OSError as error:
            print(f"unreadable file: {printable(path)}: {error}", file=sys.stderr)
            status = EXIT_ERROR
            continue
        except (yaml.YAMLError, UnicodeDecodeError, RecursionError) as error:
            print(f"unparsable YAML: {printable(path)}: {error}", file=sys.stderr)
            status = EXIT_ERROR
            continue
        for line, value in offenders:
            print(f"{printable(path)}:{line}: {value}")
        if offenders and status == EXIT_CLEAN:
            status = EXIT_OFFENDERS
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
