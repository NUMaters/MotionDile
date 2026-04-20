FROM golang:1.24-alpine AS build-agent
WORKDIR /src/agent
COPY Agent/go.mod Agent/go.sum ./
RUN go mod download
COPY Agent/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /agent-server ./cmd/server

FROM golang:1.22-alpine AS build-game
WORKDIR /src/game
COPY game/backend/go.mod game/backend/go.sum ./
RUN go mod download
COPY game/backend/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /game-server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build-agent /agent-server /agent-server
COPY --from=build-game /game-server /game-server
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh

ENV GAME_BACKEND_ADDR=0.0.0.0:8090
ENV AGENT_PORT=8091
ENV AGENT_URL=http://127.0.0.1:8091
EXPOSE 8090
USER 65532:65532
ENTRYPOINT ["/start.sh"]
