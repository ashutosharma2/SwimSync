"""Drill C: a rolling update, or a forced pod kill, of the API while swimmers book (local, kind).

Needs the cluster from scripts/k8s-up.sh. Drill A's load (drills/a/load.py, unchanged) runs for 60 s
through the web frontend, the way a browser reaches the API, and at 20 s the fault is injected:

  rollout  kubectl rollout restart deployment/api. New pods start; each old pod gets the 5 s preStop
           pause, then stops. The deployment keeps two replicas throughout.
  kill     one of the two API pods is force-deleted (--grace-period=0 --force). The Pod leaves the API
           at once, but on this cluster the kubelet still starts the preStop hook and sends SIGTERM,
           with 2 s before SIGKILL, so it isn't drill A's kill -9 (drills/03-rolling-update.md).

The hard limits are drill A's, checked by analyse.py against the cluster's database through a
temporary port-forward. A real run refuses to start until the prediction in
drills/03-rolling-update.md is written, so the prediction can't be shaped by a result.

Run:   .venv/bin/python drills/c/run.py --mode rollout
Check the harness without a fault (10 s, nothing kept): .venv/bin/python drills/c/run.py --dry-run
"""

import argparse
import json
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WRITE_UP = ROOT / "drills" / "03-rolling-update.md"
# Always name the kind context, so the drill can never act on another cluster.
K = ["kubectl", "--context", "kind-swimsync", "-n", "swimsync"]
URL = "http://127.0.0.1:8089/api"
DB_PORT = 15432
DB_URL = f"postgresql://swimsync@127.0.0.1:{DB_PORT}/swimsync"
DURATION, FAULT_AT = 60, 20


def kubectl(*args):
    return subprocess.run(K + list(args), check=True, capture_output=True, text=True).stdout


def api_pods():
    """Names of the API pods that exist right now, including any still stopping."""
    return kubectl("get", "pods", "-l", "app=api", "-o", "jsonpath={.items[*].metadata.name}").split()


def ready_replicas():
    return int(kubectl("get", "deployment/api", "-o", "jsonpath={.status.readyReplicas}") or 0)


def wait_for(condition, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if condition():
            return
        time.sleep(0.5)
    sys.exit(f"gave up waiting for {what}")


def api_answers():
    try:
        with urllib.request.urlopen(f"{URL}/health", timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def prediction_written():
    text = WRITE_UP.read_text()
    section = text.split("## Predicted symptom", 1)[1].split("\n## ", 1)[0]
    return bool(re.sub(r"<!--.*?-->", "", section, flags=re.S).strip())


def prepare():
    """Make the API match the repo's manifest with two settled pods, then reseed the database."""
    kubectl("apply", "-f", str(ROOT / "k8s" / "app.yaml"))
    kubectl("rollout", "status", "deployment/api", "--timeout=180s")
    wait_for(lambda: len(api_pods()) == 2 and ready_replicas() == 2, 120, "two settled API pods")
    kubectl("delete", "job", "seed", "--ignore-not-found")
    kubectl("apply", "-f", str(ROOT / "k8s" / "seed.yaml"))
    kubectl("wait", "--for=condition=complete", "job/seed", "--timeout=180s")
    wait_for(api_answers, 60, "the API to answer through the web frontend")


def port_forward():
    """Forward the cluster's database to 127.0.0.1:15432 for the analysis."""
    proc = subprocess.Popen(K + ["port-forward", "svc/db", f"{DB_PORT}:5432"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def listening():
        with socket.socket() as s:
            return s.connect_ex(("127.0.0.1", DB_PORT)) == 0
    wait_for(listening, 30, "the database port-forward")
    return proc


def inject(mode, events):
    events["pods_before"] = api_pods()
    events["fault_at"] = time.time()
    if mode == "rollout":
        kubectl("rollout", "restart", "deployment/api")
        kubectl("rollout", "status", "deployment/api", "--timeout=120s")
        events["fault_done"] = time.time()  # the new pods are ready
        # The old pods keep answering through their preStop pause; record when the last one is gone.
        wait_for(lambda: not set(events["pods_before"]) & set(api_pods()), 120, "the old pods to stop")
        events["old_pods_gone"] = time.time()
    else:
        victim = events["pods_before"][0]
        events["killed_pod"] = victim
        kubectl("delete", "pod", victim, "--grace-period=0", "--force")
        wait_for(lambda: victim not in api_pods() and ready_replicas() == 2, 120, "a replacement pod")
        events["fault_done"] = time.time()  # the replacement is ready
    events["pods_after"] = api_pods()


def main():
    sys.stdout.reconfigure(line_buffering=True)  # progress lines appear in order, even through a pipe
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["rollout", "kill"], default="rollout")
    parser.add_argument("--dry-run", action="store_true", help="10 s of load, no fault, nothing kept")
    args = parser.parse_args()

    if not args.dry_run and not prediction_written():
        sys.exit(f"Write the prediction in {WRITE_UP.relative_to(ROOT)} (Predicted symptom) before the first run.")

    duration = 10 if args.dry_run else DURATION
    mode = "dry-run" if args.dry_run else args.mode
    if args.dry_run:
        out = pathlib.Path(tempfile.mkdtemp(prefix="drill-c-dry-run-"))
    else:
        out = ROOT / "drills" / "results" / f"c-{mode}-{time.strftime('%Y%m%d-%H%M%S')}"
        out.mkdir(parents=True)

    print("Preparing: two settled API pods and a freshly seeded database...")
    prepare()
    forward = port_forward()
    try:
        events = {"mode": mode, "duration_s": duration, "load_start": time.time()}
        load = subprocess.Popen([sys.executable, str(ROOT / "drills" / "a" / "load.py"), "--url", URL,
                                 "--duration", str(duration), "--out", str(out / "attempts.jsonl")])
        if not args.dry_run:
            time.sleep(FAULT_AT)
            print(f"{time.strftime('%H:%M:%S')} injecting the fault: {mode}")
            inject(mode, events)
            print(f"{time.strftime('%H:%M:%S')} fault handled: {json.dumps({k: v for k, v in events.items() if 'pods' in k or k == 'killed_pod'})}")
        load.wait()
        events["load_end"] = time.time()
        (out / "events.json").write_text(json.dumps(events, indent=2))
        (out / "k8s-events.txt").write_text(subprocess.run(
            K + ["get", "events", "--sort-by=.lastTimestamp"], capture_output=True, text=True).stdout)
        result = subprocess.run([sys.executable, str(HERE / "analyse.py"), str(out), "--db", DB_URL])
    finally:
        forward.terminate()
    if args.dry_run:
        shutil.rmtree(out)
        print("\nDry run: the harness works; nothing was kept.")
    else:
        print(f"\nResults in {out.relative_to(ROOT)}")
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
