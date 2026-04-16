# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/game-backend ./cmd/server

FROM alpine:3.20

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app

COPY --from=builder /out/game-backend /usr/local/bin/game-backend

ENV GAME_BACKEND_ADDR=0.0.0.0:8090
EXPOSE 8090

USER app
ENTRYPOINT ["/usr/local/bin/game-backend"]

