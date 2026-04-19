package config

import (
	"os"
	"strings"
)

// DefaultBedrockModel はコスト重視の既定（Claude 3 Haiku）。
const DefaultBedrockModel = "anthropic.claude-3-haiku-20240307-v1:0"

type Config struct {
	Port           string
	AWSRegion      string
	BedrockModelID string
}

func Load() Config {
	loadDotEnv()
	c := Config{
		Port:           os.Getenv("AGENT_PORT"),
		AWSRegion:      os.Getenv("AWS_REGION"),
		BedrockModelID: strings.TrimSpace(os.Getenv("BEDROCK_MODEL_ID")),
	}
	if c.Port == "" {
		c.Port = "8091"
	}
	return c
}

func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}
