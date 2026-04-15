package config

import (
	"os"
	"strings"
)

type Config struct {
	OpenAIKey string
	Port      string
}

func Load() Config {
	loadDotEnv()
	c := Config{
		OpenAIKey: os.Getenv("OPENAI_API_KEY"),
		Port:      os.Getenv("AGENT_PORT"),
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
