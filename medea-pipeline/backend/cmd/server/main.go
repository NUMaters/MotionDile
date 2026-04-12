package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type trainRequest struct {
	Version int                      `json:"version"`
	Samples []map[string]interface{} `json:"samples"`
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthzHandler)
	mux.HandleFunc("/api/pipeline/train", trainHandler)

	addr := "127.0.0.1:8080"
	log.Printf("[medea-backend] listening on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func healthzHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":   true,
		"time": time.Now().Format(time.RFC3339),
	})
}

func trainHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "message": "method not allowed"})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "message": err.Error()})
		return
	}

	var req trainRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "message": "invalid json"})
		return
	}
	if len(req.Samples) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "message": "samples is empty"})
		return
	}

	projectRoot, err := detectProjectRoot()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"ok": false, "message": err.Error()})
		return
	}

	datasetPath := filepath.Join(projectRoot, "medea-pipeline", "data", "hand-dataset.json")
	modelPath := filepath.Join(projectRoot, "public", "models", "hand-control-model.json")
	trainScript := filepath.Join(projectRoot, "medea-pipeline", "scripts", "train-hand-control-model.ts")

	if err := os.MkdirAll(filepath.Dir(datasetPath), 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"ok": false, "message": err.Error()})
		return
	}

	payload := map[string]interface{}{
		"version":   1,
		"createdAt": time.Now().Format(time.RFC3339),
		"samples":   req.Samples,
	}
	encoded, _ := json.MarshalIndent(payload, "", "  ")
	encoded = append(encoded, '\n')
	if err := os.WriteFile(datasetPath, encoded, 0o644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"ok": false, "message": err.Error()})
		return
	}

	cmd := exec.Command("npx", "--yes", "tsx", trainScript, datasetPath, modelPath)
	cmd.Dir = projectRoot
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":      false,
			"message": fmt.Sprintf("train failed: %v", err),
			"log":     string(out),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"message": "trained",
		"log":     string(out),
	})
}

func detectProjectRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	cur := wd
	for i := 0; i < 8; i++ {
		if exists(filepath.Join(cur, "package.json")) && exists(filepath.Join(cur, "medea-pipeline")) {
			return cur, nil
		}
		next := filepath.Dir(cur)
		if next == cur {
			break
		}
		cur = next
	}
	return "", fmt.Errorf("project root not found from cwd: %s", wd)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeJSON(w http.ResponseWriter, code int, payload map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}
