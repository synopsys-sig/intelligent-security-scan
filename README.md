# Synopsys Intelligent Security Scan

## Overview

The Synopsys Intelligent Security Scan Action helps selectively perform SAST and SCA scans, triggered during a variety of GitHub Platform events, such as push or pull request. The Synopsys Intelligent Security Scan Action allows your projects to run the only required type of security scans, optimizing the time taken by security testing and provide a quicker feedback on scan results.

## Prerequisites

Intelligent Scan server-side components – IQ and Workflow – must be setup on an instance, accessible to GitHub actions.

## Example YAML config

```yaml
name: "Synopsys Intelligent Security Scan"

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  security:
    name: security scans
    runs-on: ubuntu-latest

    steps:
    - name: Checkout repository
      uses: actions/checkout@v2

    # If this run was triggered by a pull request event, then checkout
    # the head of the pull request instead of the merge commit.
    - run: git checkout HEAD^2
      if: ${{ github.event_name == 'pull_request' }}

    - name: Synopsys Intelligent Security Scan
      id: prescription
      uses: sig-devsecops/synopsys-intelligent-scan@v1.1
      with:
        ioServerHost: "${{ secrets.IO_SERVER_HOST}}"
        ioServerToken: "${{ secrets.IO_SERVER_TOKEN}}"
        workflowServerToken: "${{ secrets.WORKFLOW_SERVER_TOKEN}}"
        additionalWorkflowArgs: ""
        stage: "IO"

    # Scan to be performed, please note the ID in previous step was
    # set to prescription in order for this to work
    - name: Scan Triggers
      run: |
        echo "SAST: ${{steps.prescription.outputs.sastScan}}"
        echo "SCA: ${{ steps.prescription.outputs.scaScan}}"
        echo "DAST: ${{steps.prescription.outputs.dastScan}}"

    - name: Synopsys Intelligent Security Scan
      uses: sig-devsecops/synopsys-intelligent-scan@v1.1
      with:
        ioServerHost: "${{ secrets.IO_SERVER_HOST}}"
        ioServerToken: "${{ secrets.IO_SERVER_TOKEN}}"
        workflowServerToken: "${{ secrets.WORKFLOW_SERVER_TOKEN}}"
        additionalWorkflowArgs: "--slack.token=${{secrets.SLACK_TOKEN}} --IS_SAST_ENABLED=${{steps.prescription.outputs.sastScan}}"
        stage: "WORKFLOW"
```
