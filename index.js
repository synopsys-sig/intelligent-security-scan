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
	
	let scmType = "github"
	let scmOwner = process.env.GITHUB_REPOSITORY.split('/')[0]
	let scmRepoName = process.env.GITHUB_REPOSITORY.split('/')[1]
	let scmBranchName = ""
	let githubUsername = process.env.GITHUB_ACTOR
	let asset_id = process.env.GITHUB_REPOSITORY

	if( process.env.GITHUB_EVENT_NAME === "push" ){
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
		shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
		shell.exec(`chmod +x prescription.sh`)
		shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		
		rcode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --io.manifest.url=${ioManifestUrl} --stage=${stage} --workflow.version=${workflowVersion} --asset.id=${asset_id} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} --IS_SAST_ENABLED=true --IS_SCA_ENABLED=true ${additionalWorkflowArgs}`).code;
		
		if (rcode != 0){
			core.error(`Error: Execution failed and returncode is ${rcode}`);
			core.setFailed(error.message);
		}
		
		let rawdata = fs.readFileSync('result.json');
		let result_json = JSON.parse(rawdata);
		let is_sast_enabled = result_json.security.activities.sast.enabled
		let is_sca_enabled = result_json.security.activities.sca.enabled
		console.log('Is SAST Enabled: '+is_sast_enabled);
		console.log('Is SCA Enabled: '+is_sca_enabled);
		
		shell.exec(`echo ::set-output name=sastScan::${is_sast_enabled}`)
		shell.exec(`echo ::set-output name=scaScan::${is_sca_enabled}`)
	}
	else if (stage.toUpperCase() === "WORKFLOW")  {
		console.log("Adding scan tool parameters")
		// file doesn't exist
		if (!fs.existsSync("prescription.sh")) {
			shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
			shell.exec(`chmod +x prescription.sh`)
			shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		}
		var wffilecode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --io.manifest.url=${ioManifestUrl} --stage=${stage} --workflow.version=${workflowVersion} --workflow.url=${workflowServerUrl} --asset.id=${asset_id} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} ${additionalWorkflowArgs}`).code;
		if (wffilecode == 0) {
			console.log("Workflow file generated successfullly....Calling WorkFlow Engine")
			var wfclientcode = shell.exec(`java -jar WorkflowClient.jar --workflowengine.url="${workflowServerUrl}" --io.manifest.path=synopsys-io.yml`).code;
			if (wfclientcode != 0) {
				core.error(`Error: Workflow failed and returncode is ${wfclientcode}`);
				core.setFailed(error.message);
			}
		}
		else {
			core.error(`Error: Workflow file generation failed and returncode is ${wffilecode}`);
			core.setFailed(error.message);
		}
	}
	else {
		core.error(`Error: Invalid stage given as input`);
		core.setFailed(error.message);
	}
}

catch (error) {
	core.setFailed(error.message);
}

