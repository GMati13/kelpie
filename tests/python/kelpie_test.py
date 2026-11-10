"""Helpers for the Python tests (run by ./test.sh with `python3 -I -m unittest discover`)."""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODS = os.path.join(REPO, "mods", "kelpie")


def load(name, argv=()):
    """Imports mods/kelpie/<name>.py as a module, with sys.argv set to `argv` while it loads (a script
    that reads its arguments at import, like kittyfix.py)."""
    saved = sys.argv
    sys.argv = [name + ".py", *argv]
    try:
        spec = importlib.util.spec_from_file_location("kelpie_" + name, os.path.join(MODS, name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        sys.argv = saved
    return module


def temp_dir(case):
    """A throwaway folder (real path) removed after the test."""
    d = os.path.realpath(tempfile.mkdtemp(prefix="kelpie-test-"))
    case.addCleanup(shutil.rmtree, d, True)
    return d


def clean_env(home):
    """An environment with only PATH and a temp HOME, and no git config of the person's."""
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home, "LANG": "C",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def run_script(name, args, home):
    """Runs mods/kelpie/<name>.py as Kelpie does (python3 -I) and returns the CompletedProcess."""
    return subprocess.run([sys.executable, "-I", os.path.join(MODS, name + ".py"), *args],
                          capture_output=True, text=True, env=clean_env(home), timeout=30)


def git(cwd, *args):
    """git for fixtures: no config of the person's, a fixed author."""
    return subprocess.run(["git", "-c", "user.name=Kelpie Test", "-c", "user.email=test@example.com",
                           "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
                          cwd=cwd, check=True, capture_output=True, text=True, env=clean_env(cwd)).stdout


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return path
