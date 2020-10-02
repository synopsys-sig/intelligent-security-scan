const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');

try {
	const ioServerHost = core.getInput('ioServerHost');
	const ioServerPort = core.getInput('ioServerPort');
	const ioServerToken = core.getInput('ioServerToken');
	var workflowServerHost = core.getInput('workflowServerHost');
	const workflowServerPort = core.getInput('workflowServerPort');
	const workflowServerToken = core.getInput('workflowServerToken');
	const workflowVersion = core.getInput('workflowVersion');
	const applicationManifest = core.getInput('applicationManifest');
	const ioManifest = core.getInput('ioManifest');
	const workflowManifest = core.getInput('workflowManifest');
	const additionalWorkflowArgs = core.getInput('additionalWorkflowArgs')
	const stage = core.getInput('stage')
	var rcode = -1

	if(workflowServerHost === "ioServerHost") {
		workflowServerHost = ioServerHost
	}

	// Irrespective of Machine this should be invoked
	if(stage.toUpperCase() === "IO") {
		console.log("Triggering prescription")
		shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
		shell.exec(`chmod +x prescription.sh`)
		shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		rcode = shell.exec(`./prescription.sh --IO.url=${ioServerHost}:${ioServerPort} --IO.token=${ioServerToken} --app.manifest.path=${applicationManifest} --sec.manifest.path=${ioManifest} --stage=${stage} ${additionalWorkflowArgs}`).code;

		if (rcode != 0){
			core.error(`Error: Execution failed and returncode is ${rcode}`);
			core.setFailed(error.message);
		}
	}
	else if (stage.toUpperCase() === "WORKFLOW")  {
		console.log("Adding scan tool parameters")
		// file doesn't exist
		if (!fs.existsSync("prescription.sh")) {
			shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/prescription.sh`)
			shell.exec(`chmod +x prescription.sh`)
			shell.exec(`sed -i -e 's/\r$//' prescription.sh`)
		}
		var wffilecode = shell.exec(`./prescription.sh --stage=${stage} --workflow.template=${workflowManifest} ${additionalWorkflowArgs}`).code;
		if (wffilecode == 0) {
			console.log("Workflow file generated successfullly....Calling WorkFlow Engine")
			shell.exec(`wget https://sigdevsecops.blob.core.windows.net/intelligence-orchestration/${workflowVersion}/WorkflowClient.jar`)
			shell.exec(`chmod +x WorkflowClient.jar`)
			var wfclientcode = shell.exec(`java -jar WorkflowClient.jar --workflowengine.url="${workflowServerHost}:${workflowServerPort}" --workflowengine.token="${workflowServerToken}" --app.manifest.path=${applicationManifest} --sec.manifest.path=synopsys-io-workflow.yml`).code;
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

