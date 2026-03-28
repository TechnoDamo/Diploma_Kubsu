FROM golang:1.24-alpine AS test

WORKDIR /src/api

COPY . .

RUN go test ./...

FROM test AS builder

RUN go build -o /out/mimir-api ./cmd/api
RUN go build -o /out/mimir-worker ./cmd/worker

FROM alpine:3.21 AS runtime

WORKDIR /app

RUN apk add --no-cache ca-certificates curl

COPY --from=builder /out/mimir-api /app/mimir-api
COPY --from=builder /out/mimir-worker /app/mimir-worker
COPY ./prompts /app/prompts

RUN mkdir -p /app/var/files

EXPOSE 8080

CMD ["/app/mimir-api"]
