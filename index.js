// Copyright (c) 2021 Synopsys, Inc. All rights reserved worldwide.

const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec)

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

	if( process.env.GITHUB_EVENT_NAME === "push" || process.env.GITHUB_EVENT_NAME === "workflow_dispatch"){
		scmBranchName = process.env.GITHUB_REF.split('/')[2]
	}
	else if( process.env.GITHUB_EVENT_NAME === "pull_request") {
		scmBranchName = process.env.GITHUB_HEAD_REF
	}
	
	if(ioServerToken === "" && ioServerUrl === "http://localhost:9090"){
		//optionally can run ephemeral IO containers here
		console.log("\nAuthenticating the Ephemeral IO Server");
		shell.exec(`curl -X POST ${ioServerUrl}/io/user/signup -H "Content-Type:application/json" -d '{"userName": "user123", "password": "P@ssw0rd!", "confirmPassword":"P@ssw0rd!"}'`)
		var ioTempToken = shell.exec(`curl -X POST ${ioServerUrl}/io/user/token -H "Content-Type:application/json" -d '{"userName": "user123", "password": "P@ssw0rd!"}'`, { silent: true }).stdout
		ioServerToken = ioTempToken;
		console.log("\nEphemeral IO Server Authentication Completed");
	}
	
	// Irrespective of Machine this should be invoked
	if(stage.toUpperCase() === "IO") {
		console.log("Triggering prescription")

		removeFile("prescription.sh");

		shell.exec(`wget https://raw.githubusercontent.com/synopsys-sig/io-artifacts/${workflowVersion}/prescription.sh`)
		shell.exec(`chmod +x prescription.sh`)
		shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		
		rcode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --io.manifest.url=${ioManifestUrl} --manifest.type=${manifestType} --stage=${stage} --release.type=${releaseType} --workflow.version=${workflowVersion} --asset.id=${asset_id} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} --IS_SAST_ENABLED=false --IS_SCA_ENABLED=false --IS_DAST_ENABLED=false ${additionalWorkflowArgs}`).code;
		
		if (rcode != 0){
			core.error(`Error: Execution failed and returncode is ${rcode}`);
			core.setFailed(error.message);
		}
		
		let rawdata = fs.readFileSync('result.json');
		let result_json = JSON.parse(rawdata);
		let is_sast_enabled = result_json.security.activities.sast.enabled
		let is_sca_enabled = result_json.security.activities.sca.enabled
		let is_dast_enabled = ((result_json.security.activities.dast && result_json.security.activities.dast.enabled) || false);
		console.log("================================== IO Prescription =======================================")
		console.log('Is SAST Enabled: '+is_sast_enabled);
		console.log('Is SCA Enabled: '+is_sca_enabled);

		if (getPersona() === "devsecops") {
		    console.log("==================================== IO Risk Score =======================================")
			console.log(`Buisness Criticality Score - ${result_json.riskScoreCard.bizCriticalityScore}`)
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
		removeFile("synopsys-io.yml");
		removeFile("synopsys-io.json");
	}
	else if (stage.toUpperCase() === "WORKFLOW")  {
		console.log("Adding scan tool parameters")
		// file doesn't exist
		if (!fs.existsSync("prescription.sh")) {
			shell.exec(`wget https://raw.githubusercontent.com/synopsys-sig/io-artifacts/${workflowVersion}/prescription.sh`)
			shell.exec(`chmod +x prescription.sh`)
			shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		}
		var wffilecode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --io.manifest.url=${ioManifestUrl} --manifest.type=${manifestType} --stage=${stage} --release.type=${releaseType} --workflow.version=${workflowVersion} --workflow.url=${workflowServerUrl} --asset.id=${asset_id} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} --IS_SAST_ENABLED=false --IS_SCA_ENABLED=false --IS_DAST_ENABLED=false ${additionalWorkflowArgs}`).code;
		let configFile = ""
		if (wffilecode == 0) {
			console.log("Workflow file generated successfullly....Calling WorkFlow Engine")
			if(manifestType === "yml"){
				configFile = "synopsys-io.yml"
			}
			else if(manifestType === "json"){
				configFile = "synopsys-io.json"
			}
			var wfclientcode = shell.exec(`java -jar WorkflowClient.jar --workflowengine.url="${workflowServerUrl}" --io.manifest.path="${configFile}"`).code;
			if (wfclientcode != 0) {
				core.error(`Error: Workflow failed and returncode is ${wfclientcode}`);
				core.setFailed(error.message);
			}

			let rawdata = fs.readFileSync('wf-output.json');
			let wf_output_json = JSON.parse(rawdata);
			console.log("========================== IO WorkflowEngine Summary ============================")
			console.log(`Breaker Status - ${wf_output_json.breaker.status}`)
		}
		else {
			core.error(`Error: Workflow file generation failed and returncode is ${wffilecode}`);
			core.setFailed(error.message);
		}
		removeFile(configFile);
	}
	else {
		core.error(`Error: Invalid stage given as input`);
		core.setFailed(error.message);
	}
}

catch (error) {
	core.setFailed(error.message);
}

function removeFile(fileName) {
	if (fs.existsSync(fileName)) {
		try {
			fs.unlinkSync(fileName);
		} catch (err) {
		}
	}
}


function getPersona() {
	let additionalWorkflowOptions = additionalWorkflowArgs.split(" ")
	additionalWorkflowOptions.forEach((v) => {
		let opt = v.split("=")
		if (opt[0] === "--persona") {
			return opt[1]
		}
	})
}