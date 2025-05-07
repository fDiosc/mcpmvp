#!/bin/bash

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test dynamic tools functionality
echo -e "${BLUE}===== Dynamic Tools Test Script =====${NC}"

# Make sure server is running
echo -e "\n${YELLOW}[1] Checking if MCP server is running...${NC}"
if ! curl -s http://localhost:3333/tools > /dev/null; then
  echo -e "${RED}❌ MCP server is not running. Please start the server first.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ MCP server is running${NC}"
fi

# Test fetching all tools
echo -e "\n${YELLOW}[2] Testing tools endpoint (no filtering)...${NC}"
ALL_TOOLS=$(curl -s http://localhost:3333/tools)
TOOL_COUNT=$(echo $ALL_TOOLS | grep -o '"name"' | wc -l)
echo -e "${GREEN}Retrieved $TOOL_COUNT tools${NC}"

# Test metrics endpoint
echo -e "\n${YELLOW}[3] Testing metrics endpoint...${NC}"
METRICS=$(curl -s http://localhost:3333/tools/metrics)
echo -e "${GREEN}Current metrics:${NC}"
echo $METRICS | json_pp

# Test fetching tools with context parameter
echo -e "\n${YELLOW}[4] Testing tools endpoint with context parameter...${NC}"
CONTEXT_TOOLS=$(curl -s "http://localhost:3333/tools?context=email")
CONTEXT_TOOL_COUNT=$(echo $CONTEXT_TOOLS | grep -o '"name"' | wc -l)
echo -e "${GREEN}Retrieved $CONTEXT_TOOL_COUNT tools with email context${NC}"

# Reset metrics
echo -e "\n${YELLOW}[5] Testing metrics reset...${NC}"
RESET_RESPONSE=$(curl -s -X POST http://localhost:3333/tools/metrics/reset)
echo -e "${GREEN}Metrics reset response:${NC}"
echo $RESET_RESPONSE | json_pp

# Get updated metrics
echo -e "\n${YELLOW}[6] Getting updated metrics...${NC}"
UPDATED_METRICS=$(curl -s http://localhost:3333/tools/metrics)
echo -e "${GREEN}Updated metrics:${NC}"
echo $UPDATED_METRICS | json_pp

echo -e "\n${BLUE}===== Test Completed =====${NC}" 