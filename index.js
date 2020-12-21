const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');

try {
	const ioServerUrl = core.getInput('ioServerUrl');
	const ioServerToken = core.getInput('ioServerToken');
	const workflowServerUrl = core.getInput('workflowServerUrl');
	const workflowServerToken = core.getInput('workflowServerToken');
	const workflowVersion = core.getInput('workflowVersion');
	const ioManifestUrl = core.getInput('ioManifestUrl');
	const additionalWorkflowArgs = core.getInput('additionalWorkflowArgs')
	const stage = core.getInput('stage')
	var rcode = -1

	// Irrespective of Machine this should be invoked
	if(stage.toUpperCase() === "IO") {
		console.log("Triggering prescription")
		shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
		shell.exec(`chmod +x prescription.sh`)
		shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		
		let templateUrl = "";
		if(ioManifestUrl !== null && ioManifestUrl !== '')
		{
			templateUrl = ioManifestUrl;
		}
		else{
			templateUrl = `https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/synopsys-io.yml`
		}

		let scmType = "github" 
		let scmOwner = process.env.GITHUB_REPOSITORY.split('/')[0]
		let scmRepoName = process.env.GITHUB_REPOSITORY.split('/')[1]
		let scmBranchName = ""
		let githubUsername = process.env.GITHUB_ACTOR

		if( process.env.GITHUB_EVENT_NAME === "push" ){
			scmBranchName = process.env.GITHUB_REF.split('/')[2]
		}
		else if( process.env.GITHUB_EVENT_NAME === "pull_request") {
			scmBranchName = process.env.GITHUB_HEAD_REF
		}
		
		rcode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --io.manifest.url=${ioManifestUrl} --stage=${stage} --workflow.version=${workflowVersion} --scm.type=${scmType} --scm.owner=${scmOwner} --scm.repo.name=${scmRepoName} --scm.branch.name=${scmBranchName} --github.username=${githubUsername} ${additionalWorkflowArgs}`).code;
		
		if (rcode != 0){
			core.error(`Error: Execution failed and returncode is ${rcode}`);
			core.setFailed(error.message);
		}
		shell.exec(`echo "::set-output name=sastScan::$(ruby -rjson -e 'j = JSON.parse(File.read("result.json")); puts j["security"]["activities"]["sast"]["enabled"]')"`)
		shell.exec(`echo "::set-output name=scaScan::$(ruby -rjson -e 'j = JSON.parse(File.read("result.json")); puts j["security"]["activities"]["sca"]["enabled"]')"`)
		shell.exec(`echo "::set-output name=dastScan::$(ruby -rjson -e 'j = JSON.parse(File.read("result.json")); puts j["security"]["activities"]["dast"]["enabled"]')"`)
	}
	else if (stage.toUpperCase() === "WORKFLOW")  {
		console.log("Adding scan tool parameters")
		// file doesn't exist
		if (!fs.existsSync("prescription.sh")) {
			shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
			shell.exec(`chmod +x prescription.sh`)
			shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		}
		var wffilecode = shell.exec(`./prescription.sh --io.url=${ioServerUrl} --io.token=${ioServerToken} --stage=${stage} --workflow.url=${workflowServerUrl} --workflow.token=${workflowServerToken} --workflow.version=${workflowVersion} --io.manifest.url=${ioManifestUrl} ${additionalWorkflowArgs}`).code;
		if (wffilecode == 0) {
			console.log("Workflow file generated successfullly....Calling WorkFlow Engine")
			var wfclientcode = shell.exec(`java -jar WorkflowClient.jar --workflowengine.url="${workflowServerUrl}" --workflowengine.token="${workflowServerToken}" --io.manifest.path=synopsys-io.yml`).code;
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

