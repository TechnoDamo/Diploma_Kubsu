.PHONY: up down download-model check-model

up:
	docker compose up -d --wait

down:
	docker compose down

download-model:
	uv run ../scripts/download_hf_model.py \
		--repo-id $(LLM_HF_REPO) \
		--local-dir $(LLM_MODELS_DIR)/models--$$(echo $(LLM_HF_REPO) | tr / --)

check-model:
	@test -f $(LLM_MODELS_DIR)/models--$$(echo $(LLM_HF_REPO) | tr / --)/config.json && echo "OK" || echo "MISSING"
