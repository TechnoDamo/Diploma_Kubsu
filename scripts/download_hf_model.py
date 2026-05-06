import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Download Hugging Face model")
    parser.add_argument("--repo-id", required=True, help="HF repo ID (e.g. Qwen/Qwen2.5-0.5B-Instruct)")
    parser.add_argument("--local-dir", required=True, help="Local directory to save model")
    parser.add_argument("--token", default=os.environ.get("HUGGING_FACE_HUB_TOKEN", ""), help="HF token")
    parser.add_argument("--endpoint", default=os.environ.get("HF_ENDPOINT", "https://huggingface.co"), help="HF endpoint")
    args = parser.parse_args()

    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_ENDPOINT"] = args.endpoint

    if args.token:
        os.environ["HUGGING_FACE_HUB_TOKEN"] = args.token

    from huggingface_hub import snapshot_download

    os.makedirs(args.local_dir, exist_ok=True)
    print(f"Downloading {args.repo_id} to {args.local_dir}...")

    snapshot_download(
        repo_id=args.repo_id,
        local_dir=args.local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )
    print("Download complete")


if __name__ == "__main__":
    main()
