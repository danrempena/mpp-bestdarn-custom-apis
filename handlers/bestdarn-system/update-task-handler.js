import AbstractHandler from '../abstract-handler'
// import helper from '../../lib/helper'
import bestdarnSystemAxios from '../../lib/bestdarn-system-axios'

export class BestDarnSystemUpdateTaskHandler extends AbstractHandler {
  async main (callback) {
    try {
      // const { SPResults: jobData } = this._event
      console.log(this._event)
      const jobData = []
      if (Boolean(jobData) && jobData.length) {
        this._currentJobData = jobData
        console.log('Processing Data: ', jobData.length)
        const self = this
        await Promise.all(jobData.map(async (data) => {
          try {
            const result = await self.updateBestDarnTask(data)
            self._successQueue.push({ data: data, result: result })
          } catch (error) {
            console.error('Failure for: ', data, '\nError: ', error)
            if (self.isClientError(error)) {
              self._notifyQueue.push({ data: data, error: error })
            } else {
              self._failedQueue.push({ data: data, error: error })
            }
          }
        }))
      } else {
        console.log('No available data to process!')
      }
      if (this._failedQueue.length > 0) {
        await this.handleFailedQueue()
      }

      if (this._notifyQueue.length > 0) {
        await this.handleNotifyQueue()
      }
      callback(null, {
        'success': this._successQueue,
        'fail': this._failedQueue,
        'notify': this._notifyQueue
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

    if (response.hasOwnProperty('message') && response.status === 200) {
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
