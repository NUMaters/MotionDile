FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod tidy
COPY . .
# ECS Fargate 既定は linux/amd64（exec format error 防止）
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /server /server
ENV AGENT_PORT=8091
EXPOSE 8091
USER 65532:65532
ENTRYPOINT ["/server"]
