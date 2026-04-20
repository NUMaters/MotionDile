package config

import (
	"os"
	"strings"
)

const DefaultBedrockModel = "anthropic.claude-3-haiku-20240307-v1:0"
const DefaultOpenAIModel = "gpt-4o-mini"

type Config struct {
	Port           string
	AWSRegion      string
	BedrockModelID string
	OpenAIAPIKey   string
	OpenAIModel    string
}

func Load() Config {
	loadDotEnv()
	c := Config{
		Port:           os.Getenv("AGENT_PORT"),
		AWSRegion:      os.Getenv("AWS_REGION"),
		BedrockModelID: strings.TrimSpace(os.Getenv("BEDROCK_MODEL_ID")),
		OpenAIAPIKey:   strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		OpenAIModel:    strings.TrimSpace(os.Getenv("OPENAI_MODEL")),
	}
	if c.Port == "" {
		c.Port = "8091"
	}
	if c.OpenAIModel == "" {
		c.OpenAIModel = DefaultOpenAIModel
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
