# 本番・ECS Fargate 向け（ローカルは `go run` のままで可）
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# ECS Fargate 既定は linux/amd64。Apple Silicon でビルドしても amd64 バイナリに固定する
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /server /server
ENV GAME_BACKEND_ADDR=0.0.0.0:8090
EXPOSE 8090
USER 65532:65532
ENTRYPOINT ["/server"]
