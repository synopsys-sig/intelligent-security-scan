// Copyright (c) 2021 Synopsys, Inc. All rights reserved worldwide.

const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const stream = require('stream');

const unzipper = require("unzipper");

async function IO() {
	try {
		const ioServerUrl = core.getInput('ioServerUrl');
		var ioServerToken = core.getInput('ioServerToken');
		const workflowServerUrl = core.getInput('workflowServerUrl');
		const workflowVersion = core.getInput('workflowVersion');
		const ioManifestUrl = core.getInput('ioManifestUrl');
		const additionalWorkflowArgs = core.getInput('additionalWorkflowArgs')
		const stage = core.getInput('stage')
		var rcode = -1
		const releaseType = core.getInput('releaseType')
		const manifestType = core.getInput('manifestType')

		let scmType = "github"
		let scmOwner = process.env.GITHUB_REPOSITORY.split('/')[0]
		let scmRepoName = process.env.GITHUB_REPOSITORY.split('/')[1]
		let scmBranchName = ""
		let githubUsername = process.env.GITHUB_ACTOR

		if (process.env.GITHUB_EVENT_NAME === "push" || process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
			scmBranchName = process.env.GITHUB_REF.split('/')[2]
		}
		else if (process.env.GITHUB_EVENT_NAME === "pull_request") {
			scmBranchName = process.env.GITHUB_HEAD_REF
		}

		if (ioServerToken === "" && ioServerUrl === "http://localhost:9090") {
			//optionally can run ephemeral IO containers here
			console.log("\nAuthenticating the Ephemeral IO Server");
			shell.exec(`curl ${ioServerUrl}/api/onboarding/onboard-requests -H "Content-Type:application/vnd.synopsys.io.onboard-request-2+json" -d '{"user":{"username": "ephemeraluser", "password": "P@ssw0rd!", "name":"ephemeraluser", "email":"user@ephemeral.com"}}'`, { silent: true });
			shell.exec(`curl -D cookie.txt ${ioServerUrl}/api/auth/login -H "Content-Type: application/json" -d '{"loginId": "ephemeraluser","password": "P@ssw0rd!"}'`, { silent: true });
			shell.exec(`sed -n 's/.*access_token*= *//p' cookie.txt > line.txt`);
			let access_token = shell.exec(`sed 's/;.*//' line.txt`).stdout.trim();
			shell.exec(`curl ${ioServerUrl}/api/auth/tokens -H "Authorization: Bearer ${access_token}" -H "Content-Type: application/json" -o output.json -d '{"name": "ephemeral-token"}'`, { silent: true })
			ioServerToken = shell.exec(`jq -r '.token' output.json`, { silent: true }).stdout.trim();
			removeFiles(["cookie.txt", "line.txt", "output.json"]);
			console.log("\nEphemeral IO Server Authentication Completed");
		}

		// Irrespective of Machine this should be invoked
		if (stage.toUpperCase() === "IO") {
			console.log("Triggering prescription")

			removeFiles(["io_state.json"]);

			if (!fs.existsSync("io_client-0.1.487")) {

				shell.exec(`wget http://artifactory.internal.synopsys.com/artifactory/clops-local/clops.sig.synopsys.com/io_client/0.1.487/io_client-0.1.487.zip`)

				const pipeline = promisify(stream.pipeline);

				async function unzip() {
					await pipeline(
						fs.createReadStream('io_client-0.1.487.zip'),
						unzipper.Extract({ path: './' })
					);
				}

				await unzip().catch(console.error);
			}

			let ioBinary = path.join("io_client-0.1.487", getOSType(), "bin", "io")
			shell.exec(`chmod +x ${ioBinary}`)

			let rcode = shell.exec(`${ioBinary} --stage io Scm.Type=${scmType} Scm.Owner=${scmOwner} Scm.Repository.Name=${scmRepoName} Scm.Repository.Branch.Name=${scmBranchName} Github.Username=${githubUsername} ${ioClientArgs}`);
			if (rcode.code != 0) {
				core.error(`Error: IO Client returned non-zero exit code ${rcode.code} for IO stage`);
				core.setFailed();
			}

			let rawdata = fs.readFileSync('io_state.json');
			let state = JSON.parse(rawdata);
			let activities = state.Data && state.Data.Prescription && state.Data.Prescription.Security && state.Data.Prescription.Security.Activities
			let is_sast_enabled = ((activities && activities.Sast && activities.Sast.Enabled) || false);
			let is_sca_enabled = ((activities && activities.Sca && activities.Sca.Enabled) || false);
			let is_dast_enabled = ((activities && activities.Dast && activities.Dast.Enabled) || false);

			console.log(`\n================================== IO Prescription =======================================`)
			console.log('Is SAST Enabled: ' + is_sast_enabled);
			console.log('Is SCA Enabled: ' + is_sca_enabled);

			if (getPersona(additionalWorkflowArgs) === "devsecops") {
				console.log("==================================== IO Risk Score =======================================")
				let riskScore = state.Data.Prescription && state.Data.Prescription.RiskScore
				console.log(`Business Criticality Score - ${riskScore.BusinessCriticalityScore}`)
				console.log(`Data Class Score - ${riskScore.DataClassScore}`)
				console.log(`Access Score - ${riskScore.AccessScore}`)
				console.log(`Open Vulnerability Score - ${riskScore.OpenVulnerabilityScore}`)
				console.log(`Change Significance Score - ${riskScore.ChangeSignificanceScore}`)
				let bizScore = parseFloat(riskScore.BusinessCriticalityScore.split("/")[1])
				let dataScore = parseFloat(riskScore.DataClassScore.split("/")[1])
				let accessScore = parseFloat(riskScore.AccessScore.split("/")[1])
				let vulnScore = parseFloat(riskScore.OpenVulnerabilityScore.split("/")[1])
				let changeScore = parseFloat(riskScore.ChangeSignificanceScore.split("/")[1])
				console.log(`Total Score - ${bizScore + dataScore + accessScore + vulnScore + changeScore}`)
			}

			shell.exec(`echo ::set-output name=sastScan::${is_sast_enabled}`)
			shell.exec(`echo ::set-output name=scaScan::${is_sca_enabled}`)
			shell.exec(`echo ::set-output name=dastScan::${is_dast_enabled}`)
			removeFiles(["synopsys-io.yml", "synopsys-io.json"]);
		} else if (stage.toUpperCase() === "WORKFLOW") {
			console.log("Adding scan tool parameters")
			let ioBinary = path.join("io_client-0.1.487", getOSType(), "bin", "io")
			if (!fs.existsSync("io_state.json")) {
				core.error(`Error: Workflow stage cannot be run due to non-availability of prescription`);
				core.setFailed();
			}

			if (!fs.existsSync("io_client-0.1.487")) {
				shell.exec(`wget http://artifactory.internal.synopsys.com/artifactory/clops-local/clops.sig.synopsys.com/io_client/0.1.487/io_client-0.1.487.zip`)
				const pipeline = promisify(stream.pipeline);

				async function unzip() {
					await pipeline(
						fs.createReadStream('io_client-0.1.487.zip'),
						unzipper.Extract({ path: './' })
					);
				}

				await unzip().catch(console.error);
				shell.exec(`chmod +x ${ioBinary}`)
			}

			let wffilecode = shell.exec(`${ioBinary} --stage workflow --state io_state.json Scm.Type=${scmType} Scm.Owner=${scmOwner} Scm.Repository.Name=${scmRepoName} Scm.Repository.Branch.Name=${scmBranchName} Github.Username=${githubUsername} ${ioClientArgs}`);

			if (wffilecode.code == 0) {
				let rawdata = fs.readFileSync('wf-output.json');
				let wf_output_json = JSON.parse(rawdata);
				console.log("========================== IO WorkflowEngine Summary ============================")
				console.log(`Breaker Status - ${wf_output_json.breaker.status}`)
			} else {
				core.error(`Error: IO Client returned non-zero exit code ${wffilecode.code} for workflow stage`);
				core.setFailed();
			}

			removeFiles(["synopsys-io.yml", "synopsys-io.json", "data.json", "io_state.json"]);
		} else {
			core.error(`Error: Invalid stage given as input`);
			core.setFailed();
		}
	} catch (error) {
		core.setFailed(error.message);
	}
}

IO().catch(console.error)

function removeFiles(fileNames) {
	for (let file of fileNames) {
		if (fs.existsSync(file)) {
			try {
				fs.unlinkSync(file);
			} catch (err) {
			}
		}
	}
}

function getPersona(additionalWorkflowArgs) {
	let additionalWorkflowOptions = additionalWorkflowArgs.split(" ")
	for (let value of additionalWorkflowOptions) {
		let opt = value.split("=")
		if (opt[0] === "Persona.Type") {
			return opt[1];
		}
	}
}

function getOSType() {
	switch (os.platform()) {
		case "darwin":
			return "macosx"
		case "linux":
			return "linux64"
		case "win64":
			return "win64"
		default:
			return "linux64"
	}
}