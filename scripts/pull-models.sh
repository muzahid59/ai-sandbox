#!/bin/bash

echo "Waiting for Ollama to start..."
CONTAINER_NAME="ai-sandbox-ollama-1"

# Wait for container to be running
while ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; do
    echo "Waiting for Ollama container to start..."
    sleep 5
done

echo "Container is running, waiting for service to initialize..."
sleep 10

# Check and pull DeepSeek model
echo "Checking DeepSeek model..."
if ! docker exec ${CONTAINER_NAME} ollama list | grep -q "deepseek-r1:8b"; then
    echo "Pulling DeepSeek model..."
    docker exec ${CONTAINER_NAME} ollama pull deepseek-r1:8b
else
    echo "DeepSeek model already exists"
fi

# Check and pull Llama model
echo "Checking Llama model..."
if ! docker exec ${CONTAINER_NAME} ollama list | grep -q "llama3.2"; then
    echo "Pulling Llama model..."
    docker exec ${CONTAINER_NAME} ollama pull llama3.2
else
    echo "Llama model already exists"
fi

echo "Models check completed!"