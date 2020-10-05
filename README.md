# Synopsys Intelligent Security Scan Action

## Overview

The Synopsys Intelligent Security Scan Action helps selectively perform SAST and SCA scans, triggered during a variety of GitHub Platform events, such as push or pull request. The Synopsys Intelligent Security Scan Action allows your projects to run the only required type of security scans, optimizing the time taken by security testing and provide quicker feedback on scan results.

## Prerequisites

* To use this Action you **must be a licensed Polaris customer.**
* Intelligent scan server must be deployed and accessible via GitHub Actions.

| :exclamation: To get a demo and learn more about Polaris and the Intelligent Security Scan Action [click here](https://www.synopsys.com/software-integrity/polaris/demo-github.html).|
|-----------------------------------------|

## Unclogging the Pipeline

While many AppSec tools support automation through CI tool integrations, teams often find it is very easy to bring their pipelines to a halt if they insert a security scan into the middle of it.  Rather than simply initiating a full static or software composition analysis scan whenever a GitHub Action is invoked, Polaris first reviews code changes in order to calculate a ‘risk score.’ This risk score takes into account risk rules the team have defined, as well as the scope of the changes that have been made to the code. This score is then used to determine which security scans to perform, and at what depth.

Once this determination has been made, the prescribed tests will then execute using GitHub runners or a Polaris cloud-hosted pipeline. This combination of selective testing and out-of-band execution ensures that security analysis doesn’t hinder the progress of other build and integration activities.

## Avoiding Vulnerability Overload

Another obstacle facing teams is the number of findings that can be produced by SAST and SCA analysis.  The spirit of DevOps is continuous incremental improvement, a goal that can be hard to realize when your security tools bury the team with hundreds or thousands of vulnerability reports to review.  Here too, Polaris reduces the burden on the team by filtering and prioritizing results so that teams can “avoid the noise” and focus on the more important security issues based on their risk.

Filtered and prioritized results are made available directly to the developer within the GitHub user interface via Security Analysis Results Interchange Format (SARIF – static analysis results only) as well as other tracking tools they may be using.

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
      uses: synopsys-sig/intelligent-security-scan@v1
      with:
        ioServerHost: "${{ secrets.IO_SERVER_HOST}}"
        ioServerToken: "${{ secrets.IO_SERVER_TOKEN}}"
        workflowServerToken: "${{ secrets.WORKFLOW_SERVER_TOKEN}}"
        additionalWorkflowArgs: ""
        stage: "IO"

    # Please note that the ID in previous step was set to prescription
    # in order for this logic to work also make sure that POLARIS_ACCESS_TOKEN
    # is defined in settings
    - name: Static Analysis with Polaris
      if: ${{steps.prescription.outputs.sastScan == 'true' }}
      run: |
          export POLARIS_SERVER_URL=${{ secrets.POLARIS_SERVER_URL}}
          export POLARIS_ACCESS_TOKEN=${{ secrets.POLARIS_ACCESS_TOKEN}}
          wget -q ${{ secrets.POLARIS_SERVER_URL}}/api/tools/polaris_cli-linux64.zip
          unzip -j polaris_cli-linux64.zip -d /tmp
          /tmp/polaris analyze -w

    # Please note that the ID in previous step was set to prescription
    # in order for this logic to work
    - name: Software Composition Analysis with Black Duck
      if: ${{steps.prescription.outputs.scaScan == 'true' }}
      uses: blackducksoftware/github-action@v2
      with:
        args: '--blackduck.url="${{ secrets.BLACKDUCK_URL}}" --blackduck.api.token="${{ secrets.BLACKDUCK_API_TOKEN}}" --detect.tools="DETECTOR"'

    - name: Synopsys Intelligent Security Scan
      uses: synopsys-sig/intelligent-security-scan@v1
      with:
        ioServerHost: "${{ secrets.IO_SERVER_HOST}}"
        ioServerToken: "${{ secrets.IO_SERVER_TOKEN}}"
        workflowServerToken: "${{ secrets.WORKFLOW_SERVER_TOKEN}}"
        additionalWorkflowArgs: "--slack.token=${{secrets.SLACK_TOKEN}} --IS_SAST_ENABLED=${{steps.prescription.outputs.sastScan}} --polaris.url=${{secrets.POLARIS_SERVER_URL}} --polaris.access.token=${{secrets.POLARIS_ACCESS_TOKEN}}"
        stage: "WORKFLOW"

    - name: Upload SARIF file
      uses: github/codeql-action/upload-sarif@v1
      with:
        # Path to SARIF file relative to the root of the repository
        sarif_file: workflowengine-results.sarif.json
```
