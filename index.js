// Copyright (c) 2021 Synopsys, Inc. All rights reserved worldwide.

const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec)
const util = require('util');
const stream = require('stream');

const unzipper = require("unzipper");


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
	let asset_id = process.env.GITHUB_REPOSITORY

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

		removeFiles(["io_state.json", "io_client-0.1.487.zip"]);

		shell.exec(`wget http://artifactory.internal.synopsys.com/artifactory/clops-local/clops.sig.synopsys.com/io_client/0.1.487/io_client-0.1.487.zip`)

		const pipeline = util.promisify(stream.pipeline);

		async function unzip() {
			await pipeline(
				fs.createReadStream('io_client-0.1.487.zip'),
				unzipper.Extract({ path: './' })
			);
			shell.exec(`chmod +x io_client-0.1.487/${getOSType()}/bin/io`)
		}

		unzip().catch(console.error)

		let rcode = shell.exec(`io_client-0.1.487/${getOSType()}/bin/io --stage io Io.Server.Url=${ioServerUrl} Io.Server.Token="${ioServerToken}" Scm.Type=${scmType} Scm.Owner=${scmOwner} Scm.Repository.Name=${scmRepoName} Scm.Repository.Branch.Name=${scmBranchName} Github.Username=${githubUsername} ${additionalWorkflowArgs}`);
		if (rcode.code != 0) {
			core.error(`Error: Execution failed and returncode is ${rcode.code}`);
			core.setFailed();
		}

		let rawdata = fs.readFileSync('io_state.json');
		let result_json = JSON.parse(rawdata);
		let is_sast_enabled = ((result_json.security && result_json.security.activities && result_json.security.activities.sast && result_json.security.activities.sast.enabled) || false);
		let is_sca_enabled = ((result_json.security && result_json.security.activities && result_json.security.activities.sca && result_json.security.activities.sca.enabled) || false);
		let is_dast_enabled = ((result_json.security && result_json.security.activities && result_json.security.activities.dast && result_json.security.activities.dast.enabled) || false);

		console.log(`\n================================== IO Prescription =======================================`)
		console.log('Is SAST Enabled: ' + is_sast_enabled);
		console.log('Is SCA Enabled: ' + is_sca_enabled);

		if (getPersona(additionalWorkflowArgs) === "devsecops") {
			console.log("==================================== IO Risk Score =======================================")
			console.log(`Business Criticality Score - ${result_json.riskScoreCard.bizCriticalityScore}`)
			console.log(`Data Class Score - ${result_json.riskScoreCard.dataClassScore}`)
			console.log(`Access Score - ${result_json.riskScoreCard.accessScore}`)
			console.log(`Open Vulnerability Score - ${result_json.riskScoreCard.openVulnScore}`)
			console.log(`Change Significance Score - ${result_json.riskScoreCard.changeSignificanceScore}`)
			let bizScore = parseFloat(result_json.riskScoreCard.bizCriticalityScore.split("/")[1])
			let dataScore = parseFloat(result_json.riskScoreCard.dataClassScore.split("/")[1])
			let accessScore = parseFloat(result_json.riskScoreCard.accessScore.split("/")[1])
			let vulnScore = parseFloat(result_json.riskScoreCard.openVulnScore.split("/")[1])
			let changeScore = parseFloat(result_json.riskScoreCard.changeSignificanceScore.split("/")[1])
			console.log(`Total Score - ${bizScore + dataScore + accessScore + vulnScore + changeScore}`)
		}

		shell.exec(`echo ::set-output name=sastScan::${is_sast_enabled}`)
		shell.exec(`echo ::set-output name=scaScan::${is_sca_enabled}`)
		shell.exec(`echo ::set-output name=dastScan::${is_dast_enabled}`)
		removeFiles(["synopsys-io.yml", "synopsys-io.yml", "data.json"]);
	}
	else if (stage.toUpperCase() === "WORKFLOW") {
		console.log("Adding scan tool parameters")
		// file doesn't exist
		if (!fs.existsSync("prescription.sh")) {
			shell.exec(`wget https://raw.githubusercontent.com/synopsys-sig/io-artifacts/${workflowVersion}/prescription.sh`)
			shell.exec(`chmod +x prescription.sh`)
			shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		}
		var wffilecode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token="${ioServerToken}" --io.manifest.url=${ioManifestUrl} --manifest.type=${manifestType} --stage=${stage} --release.type=${releaseType} --workflow.version=${workflowVersion} --workflow.url=${workflowServerUrl} --asset.id=${asset_id} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} --IS_SAST_ENABLED=false --IS_SCA_ENABLED=false --IS_DAST_ENABLED=false ${additionalWorkflowArgs}`).code;
		let configFile = ""
		if (wffilecode == 0) {
			console.log("Workflow file generated successfullly....Calling WorkFlow Engine")
			if (manifestType === "yml") {
				configFile = "synopsys-io.yml"
			}
			else if (manifestType === "json") {
				configFile = "synopsys-io.json"
			}
			var wfclientcode = shell.exec(`java -jar WorkflowClient.jar --workflowengine.url="${workflowServerUrl}" --io.manifest.path="${configFile}"`).code;
			if (wfclientcode != 0) {
				core.error(`Error: Workflow failed and returncode is ${wfclientcode}`);
				core.setFailed();
			}

			let rawdata = fs.readFileSync('wf-output.json');
			let wf_output_json = JSON.parse(rawdata);
			console.log("========================== IO WorkflowEngine Summary ============================")
			console.log(`Breaker Status - ${wf_output_json.breaker.status}`)
		}
		else {
			core.error(`Error: Workflow file generation failed and returncode is ${wffilecode}`);
			core.setFailed();
		}
		removeFiles([configFile]);
	}
	else {
		core.error(`Error: Invalid stage given as input`);
		core.setFailed();
	}
}

catch (error) {
	core.setFailed(error.message);
}

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