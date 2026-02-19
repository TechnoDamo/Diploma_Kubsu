.PHONY: run test proto

run:
	python cmd/server/main.py

test:
	python -m unittest discover -s tests -p "test_*.py"

proto:
	python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. --pyi_out=. worker/v1/worker.proto
