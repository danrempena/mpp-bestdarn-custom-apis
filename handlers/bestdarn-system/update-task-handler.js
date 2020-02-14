import AbstractHandler from '../abstract-handler'
import helper from '../../lib/helper'
import bestdarnSystemAxios from '../../lib/bestdarn-system-axios'

export class BestDarnSystemUpdateTaskHandler extends AbstractHandler {
  async main (callback) {
    try {
      const { ReceiptHandle, Body } = this._event
      const { data } = JSON.parse(Body)
      const { SPResults: jobData, client, job } = data
      if (Boolean(jobData) && jobData.length) {
        console.log(jobData)
        this._currentJobData = jobData
        console.log('Processing Data: ', jobData.length)
        const self = this
        await Promise.all(jobData.map(async (data) => {
          try {
            const result = await self.updateBestDarnTask(data)
            self._successQueue.push({ data: data, result: result })
          } catch (error) {
            // console.error('Failure for: ', data, '\nError: ', error.response)
            self._failedData.push(data)
            self._failedQueue.push({ data: data, error: error })
          }
        }))
      } else {
        console.log('No available data to process!')
      }

      if (this._successQueue.length > 0) {
        const { Parameter: { Value: SPJobsQueueUrl } } = await helper.get_ssm_param('JOBS_QUEUE_URL')

        console.log(ReceiptHandle)
        await helper.delete_success_job(SPJobsQueueUrl, ReceiptHandle)

        if (this._failedData.length > 0) {
          const jobData = {
            data: { client, job, SPResults: this._failedQueue }
          }
          console.log('Failed data : ', jobData)

          const queueResult = await helper.enqueue_sp_results(SPJobsQueueUrl, jobData)
          console.log(queueResult)
          console.log('Failed data added to Jobs Queue')
        }
      }
      // if (this._notifyQueue.length > 0) {
      //   await this.handleNotifyQueue()
      // }
      callback(null, {
        'success': this._successQueue,
        'fail': this._failedQueue
      })
    } catch (error) {
      console.error(error)
      await this.handleFailure(error)
      callback(error)
    }
  }

  async updateBestDarnTask (data) {
    const jobInfo = this.getContextLocalData('jobInfo')
    const { taskId, dateDue } = data
    let configRequest = { 'date_due': dateDue }
    const updateUrlPath = jobInfo.targetEndpoint.replace('[task_id]', taskId)
    const response = await bestdarnSystemAxios.post(updateUrlPath, configRequest)
    console.log('Request:\n', bestdarnSystemAxios.defaults.baseURL + updateUrlPath, '\n', configRequest)
    console.log('Response:\n', bestdarnSystemAxios.defaults.baseURL + updateUrlPath, '\n',
      response.hasOwnProperty('data') && response.data ? response.data : response)

    if (response.hasOwnProperty('data') && response.status === 200) {
      return response
    }
    throw new Error(response.data)
  }
}

export const jobInfo = {
  id: 'BestDarnUpdateTask',
  name: 'Updating Task of BestDarn CRM',
  targetEndpoint: '/tasks/[task_id]/update'
}

export const main = async (event, context, callback) => {
  context['localData'] = {
    jobInfo: jobInfo
  }
  const handler = new BestDarnSystemUpdateTaskHandler(event, context)
  await handler.main(callback)
}
