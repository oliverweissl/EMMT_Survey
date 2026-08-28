#!/usr/bin/env python3
"""Build the static survey manifests and variant image folders from samples/."""

import json
import random
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
DATA = ROOT / "data"
ASSETS = ROOT / "assets"
SEED = 20260828


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    manifest = read_json(SAMPLES / "manifest.json")
    cases = []
    for item in manifest["cases"]:
        case_dir = SAMPLES / item["directory"]
        metadata = read_json(case_dir / "metadata.json")
        result = metadata.get("result", {})
        source = result.get("data_source", {})
        vlm = result.get("vlm_output", {})
        prompt_objects = vlm.get("prompt_objects") or []
        if not prompt_objects:
            raise ValueError(f"No prompt_objects in {case_dir / 'metadata.json'}")
        adversarial = case_dir / metadata.get("images", {}).get("adversarial", "adversarial.png")
        clean = case_dir / metadata.get("images", {}).get("clean", "clean.JPEG")
        if not adversarial.exists() or not clean.exists():
            raise FileNotFoundError(f"Missing image in {case_dir}")
        cases.append({
            "case_id": metadata["survey_case_id"],
            "model": metadata["model"],
            "modality": metadata["modality"],
            "scene_type": metadata["scene_type"],
            "category": source.get("category", metadata["scene_type"]),
            "filename": source.get("filename", ""),
            "prompt": vlm["perturbed_prompt"],
            "labels": prompt_objects,
            "adversarial_source": adversarial,
            "clean_source": clean,
        })

    groups = defaultdict(list)
    for case in cases:
        groups[(case["model"], case["modality"], case["scene_type"])].append(case)
    if len(cases) != 144 or len(groups) != 48 or any(len(group) != 3 for group in groups.values()):
        raise ValueError("Expected 144 cases and exactly 3 cases in each of 48 strata")

    for path in (DATA / "variants", ASSETS):
        path.mkdir(parents=True, exist_ok=True)
    variant_cases = {"1": [], "2": [], "3": []}
    for group_number, key in enumerate(sorted(groups)):
        group = sorted(groups[key], key=lambda case: case["case_id"])
        random.Random(SEED + group_number).shuffle(group)
        for variant, case in zip(("1", "2", "3"), group):
            variant_cases[variant].append(case)

    for variant, selected in variant_cases.items():
        selected.sort(key=lambda case: case["case_id"])
        variant_asset_dir = ASSETS / f"variant-{variant}"
        if variant_asset_dir.exists():
            shutil.rmtree(variant_asset_dir)
        tasks = []
        for index, case in enumerate(selected):
            destination = variant_asset_dir / case["case_id"] / "adversarial.png"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(case["adversarial_source"], destination)
            tasks.append({
                "case_id": case["case_id"],
                "model": case["model"],
                "modality": case["modality"],
                "scene_type": case["scene_type"],
                "category": case["category"],
                "filename": case["filename"],
                "prompt": case["prompt"],
                "labels": case["labels"],
                "image": f"assets/variant-{variant}/{case['case_id']}/adversarial.png",
                "variant": variant,
                "task_index": index,
            })
        (DATA / "variants" / f"variant-{variant}.json").write_text(
            json.dumps(tasks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    clean_dir = ASSETS / "clean"
    if clean_dir.exists():
        shutil.rmtree(clean_dir)
    clean_tasks = []
    for case in sorted(cases, key=lambda item: item["case_id"]):
        destination = clean_dir / case["case_id"] / case["clean_source"].name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(case["clean_source"], destination)
        clean_tasks.append({
            "case_id": case["case_id"],
            "model": case["model"],
            "modality": case["modality"],
            "scene_type": case["scene_type"],
            "category": case["category"],
            "filename": case["filename"],
            "image": destination.relative_to(ROOT).as_posix(),
        })
    (DATA / "clean-cases.json").write_text(
        json.dumps(clean_tasks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("Built 3 variants with counts:", {key: len(value) for key, value in variant_cases.items()})


if __name__ == "__main__":
    main()
