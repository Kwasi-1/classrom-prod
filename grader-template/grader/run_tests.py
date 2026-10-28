#!/usr/bin/env python3
"""Classroom autograder test runner (Python stdlib only).

Usage: run_tests.py TESTS_YML STUDENT_DIR RESULTS_JSON [--files HIDDEN_FILES_DIR]

The app commits tests.yml together with tests.json (the same spec, already validated);
this runner reads tests.json so it needs no YAML library. Each test runs in Docker:

  docker run --rm --network none --memory 512m --cpus 1 -v STUDENT:/work -w /work IMAGE sh -c RUN

`setup` (if any) runs once per image *with* network access and *before* hidden files are
copied in, then the container is committed and the tests run offline from that snapshot.
This lets `pip install -r requirements.txt` work while hidden tests never touch the network.

Exit code is 0 whenever results.json was written, including when tests fail.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

DEFAULT_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT = 10
MAX_TIMEOUT = 60
SETUP_TIMEOUT = 300
EXCERPT_CHARS = 2000
CAPTURE_BYTES = 1_000_000
DOCKER_LIMITS = ["--memory", "512m", "--cpus", "1", "--pids-limit", "256"]


class SpecError(Exception):
    pass


# ---------------------------------------------------------------- spec validation
# Mirrors the Zod schema in the app (src/lib/tests-spec.ts).

def _str(obj, key, required=True):
    v = obj.get(key)
    if v is None:
        if required:
            raise SpecError(f"missing '{key}'")
        return None
    if not isinstance(v, str) or (required and not v.strip()):
        raise SpecError(f"'{key}' must be a non-empty string")
    return v


def validate(spec):
    if not isinstance(spec, dict):
        raise SpecError("tests file must be a mapping")
    allowed_top = {"image", "setup", "tests"}
    extra = set(spec) - allowed_top
    if extra:
        raise SpecError(f"unknown keys: {sorted(extra)}")
    image = _str(spec, "image", required=False) or DEFAULT_IMAGE
    setup = _str(spec, "setup", required=False)
    tests = spec.get("tests")
    if not isinstance(tests, list) or not tests:
        raise SpecError("'tests' must be a non-empty list")

    out, names = [], set()
    allowed = {"name", "type", "run", "input", "expected", "match", "points", "timeout", "image"}
    for i, t in enumerate(tests):
        where = f"tests[{i}]"
        if not isinstance(t, dict):
            raise SpecError(f"{where} must be a mapping")
        extra = set(t) - allowed
        if extra:
            raise SpecError(f"{where}: unknown keys {sorted(extra)}")
        try:
            name = _str(t, "name")
            ttype = t.get("type")
            if ttype not in ("io", "command"):
                raise SpecError("'type' must be io or command")
            run = _str(t, "run")
            points = t.get("points")
            if isinstance(points, bool) or not isinstance(points, (int, float)) or points < 0:
                raise SpecError("'points' must be a number >= 0")
            timeout = t.get("timeout", DEFAULT_TIMEOUT)
            if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not (0 < timeout <= MAX_TIMEOUT):
                raise SpecError(f"'timeout' must be between 1 and {MAX_TIMEOUT}")
            test = {
                "name": name,
                "type": ttype,
                "run": run,
                "points": points,
                "timeout": timeout,
                "image": _str(t, "image", required=False) or image,
            }
            if ttype == "io":
                inp = t.get("input", "")
                if not isinstance(inp, str):
                    raise SpecError("'input' must be a string")
                expected = t.get("expected")
                if not isinstance(expected, str):
                    raise SpecError("io tests need 'expected' (string)")
                match = t.get("match", "exact")
                if match not in ("exact", "contains", "regex"):
                    raise SpecError("'match' must be exact, contains or regex")
                if match == "regex":
                    re.compile(expected)
                test.update(input=inp, expected=expected, match=match)
            else:
                for k in ("input", "expected", "match"):
                    if k in t:
                        raise SpecError(f"'{k}' is only allowed on io tests")
        except (SpecError, re.error) as e:
            raise SpecError(f"{where}: {e}") from None
        if name in names:
            raise SpecError(f"duplicate test name '{name}'")
        names.add(name)
        out.append(test)
    return {"setup": setup, "tests": out}


def load_spec(yml_path):
    json_path = os.path.splitext(yml_path)[0] + ".json"
    if os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as f:
            return validate(json.load(f))
    try:
        import yaml  # optional fallback when tests.json is absent
    except ImportError:
        raise SpecError(f"{json_path} not found (and PyYAML unavailable to read {yml_path})")
    with open(yml_path, encoding="utf-8") as f:
        return validate(yaml.safe_load(f))


# ---------------------------------------------------------------- docker helpers

def _drain(stream, buf):
    """Read a pipe to EOF, keeping only the first CAPTURE_BYTES."""
    for chunk in iter(lambda: stream.read(65536), b""):
        room = CAPTURE_BYTES - len(buf)
        if room > 0:
            buf.extend(chunk[:room])


def docker_run(image, command, workdir, timeout, stdin_text="", network="none", name=None):
    """Returns (exit_code or None on timeout, stdout, stderr, duration_ms)."""
    name = name or f"grade-{uuid.uuid4().hex[:12]}"
    args = ["docker", "run", "-i", "--name", name, "--network", network, *DOCKER_LIMITS,
            "-v", f"{os.path.abspath(workdir)}:/work", "-w", "/work", image, "sh", "-c", command]
    if network == "none":
        args.insert(2, "--rm")
    start = time.monotonic()
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = bytearray(), bytearray()
    readers = [threading.Thread(target=_drain, args=(proc.stdout, out), daemon=True),
               threading.Thread(target=_drain, args=(proc.stderr, err), daemon=True)]
    for r in readers:
        r.start()
    try:
        proc.stdin.write(stdin_text.encode())
        proc.stdin.close()
    except BrokenPipeError:
        pass
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        subprocess.run(["docker", "kill", name], capture_output=True)
        proc.wait()
    for r in readers:
        r.join(timeout=5)
    duration = int((time.monotonic() - start) * 1000)
    if timed_out:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    return (None if timed_out else proc.returncode,
            out.decode("utf-8", "replace"), err.decode("utf-8", "replace"), duration)


def normalize(text):
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def excerpt(stdout, stderr):
    combined = stdout + (("\n" if stdout and stderr else "") + stderr if stderr else "")
    return combined[:EXCERPT_CHARS]


# ---------------------------------------------------------------- main

def prepare_images(spec, student_dir):
    """Pull each image and run setup once per image. Returns {image: (run_image, setup_error)}."""
    envs = {}
    for idx, image in enumerate(dict.fromkeys(t["image"] for t in spec["tests"])):
        pull = subprocess.run(["docker", "pull", "-q", image], capture_output=True, text=True)
        if pull.returncode != 0:
            envs[image] = (None, f"could not pull image {image}: {pull.stderr.strip()[:500]}")
            continue
        if not spec["setup"]:
            envs[image] = (image, None)
            continue
        name = f"grade-setup-{uuid.uuid4().hex[:12]}"
        code, out, err, _ = docker_run(image, spec["setup"], student_dir, SETUP_TIMEOUT, network="bridge", name=name)
        if code != 0:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
            reason = "timed out" if code is None else f"exited with {code}"
            envs[image] = (None, f"setup {reason}\n{excerpt(out, err)}"[:EXCERPT_CHARS])
            continue
        tag = f"grader-env-{idx}:latest"
        subprocess.run(["docker", "commit", name, tag], check=True, capture_output=True)
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        envs[image] = (tag, None)
    return envs


def run_test(test, run_image, student_dir):
    code, out, err, ms = docker_run(run_image, test["run"], student_dir, test["timeout"],
                                    stdin_text=test.get("input", ""))
    if code is None:
        passed = False
        err = (err + f"\n[timed out after {test['timeout']}s]").lstrip("\n")
    elif test["type"] == "command":
        passed = code == 0
    else:
        actual, expected = normalize(out), normalize(test["expected"])
        if test["match"] == "exact":
            passed = actual == expected
        elif test["match"] == "contains":
            passed = expected in actual
        else:
            passed = re.search(test["expected"], actual, re.MULTILINE) is not None
    return passed, ms, excerpt(out, err)


def main(argv):
    args = argv[1:]
    files_dir = None
    if "--files" in args:
        i = args.index("--files")
        files_dir = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    yml_path, student_dir, results_path = args

    def write(results):
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

    try:
        try:
            spec = load_spec(yml_path)
        except (SpecError, json.JSONDecodeError, OSError) as e:
            write({"tests": [], "error": f"invalid tests spec: {e}"})
            print(f"invalid tests spec: {e}")
            return 0

        envs = prepare_images(spec, student_dir)

        # Hidden files go in only after setup (which had network access) has finished.
        if files_dir and os.path.isdir(files_dir):
            shutil.copytree(files_dir, student_dir, dirs_exist_ok=True)

        results = []
        for test in spec["tests"]:
            run_image, setup_error = envs[test["image"]]
            if setup_error:
                passed, ms, out = False, 0, setup_error
            else:
                passed, ms, out = run_test(test, run_image, student_dir)
            results.append({
                "name": test["name"],
                "passed": passed,
                "points": test["points"] if passed else 0,
                "max_points": test["points"],
                "duration_ms": ms,
                "output_excerpt": out,
            })
            print(f"{'PASS' if passed else 'FAIL'} {test['name']} ({ms} ms)")
        write({"tests": results, "error": None})
        return 0
    except Exception as e:
        write({"tests": [], "error": f"runner crashed: {type(e).__name__}: {e}"})
        raise


if __name__ == "__main__":
    sys.exit(main(sys.argv))
