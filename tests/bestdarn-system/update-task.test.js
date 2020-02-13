import MockAdapter from 'axios-mock-adapter'
import jwt from 'jsonwebtoken'
import each from 'jest-each'
import hash from 'object-hash'
import faker from 'faker'
import qs from 'querystring'
import { VeraSystemAddDistributorHandler, jobInfo, main } from '../../handlers/bestdarn-system/update-task-handler'
import * as mockCloudwatchScheduledEvent from '../../mocks/events/cloudwatch-scheduled-event.json'
import * as mockLambdaReinvokeEvent from '../../mocks/events/lambda-reinvoke-event.json'
import mockRequest from '../../mocks/bestdarn-system/update-task/request'
import mockResponse from '../../mocks/bestdarn-system/update-task/response'
import msaAxios from '../../lib/mpp-sql-adapter-axios'
import veraSystemAxios from '../../lib/bestdarn-system-axios'
import veraSystemExpected from '../../lib/bestdarn-system-expected'
import helper from '../../lib/helper'

jest.mock('../../lib/helper')

describe('[' + jobInfo.id + '] ' + jobInfo.name, () => {
  const testCases = [
    ['aws.events', mockCloudwatchScheduledEvent],
    ['aws.lambda', mockLambdaReinvokeEvent]
  ]
  const mockMsaAccessToken = jwt.sign({ userId: 2 }, 'secret', { expiresIn: '30d' })
  const mockMsaAxios = new MockAdapter(msaAxios)
  const mockVeraSystemAxios = new MockAdapter(veraSystemAxios)
  let mockDistributors = []
  const mockJobContext = {
    functionName: 'bestdarn-system-add-distributors',
    localData: {
      jobInfo: jobInfo
    }
  }

  beforeAll(() => {
    jest.resetModules()
    helper._set_mock_client_credentials()
    helper._set_mock_access_token(mockMsaAccessToken)
  })

  afterAll(() => {
    helper._aws_mock_restore()
  })

  beforeEach(() => {
    const distributorCount = faker.random.number({ min: 1, max: 10 })
    for (let i = 0; i < distributorCount; i++) {
      mockDistributors.push(mockRequest.generate())
    }
    mockMsaAxios.onPost('/queries').reply(200, mockDistributors)

    mockLambdaReinvokeEvent.payload = JSON.stringify(mockDistributors)
    mockLambdaReinvokeEvent.md5Payload = hash.MD5(mockLambdaReinvokeEvent.payload)
    mockLambdaReinvokeEvent.retries = 1
    mockLambdaReinvokeEvent.receiptHandle = faker.random.uuid()
  })

  afterEach(() => {
    jest.clearAllMocks()
    mockMsaAxios.reset()
    mockVeraSystemAxios.reset()
    mockDistributors = []
  })

  describe('All Test Cases', () => {
    each(testCases).test('%s - mpp adapter should return list of users with format', async (source, mockEvent) => {
      const handler = new VeraSystemAddDistributorHandler(mockEvent, mockJobContext)
      const data = await handler.getJobData()
      const expected = JSON.stringify(data)
      const mocked = JSON.stringify(mockDistributors)
      expect(mocked).toEqual(expected)
    })

    each(testCases).test('%s - should have proper data and format for client custom api', async (source, mockEvent) => {
      const successMock = mockResponse.success
      mockVeraSystemAxios.onPost('/add_distributor').reply(config => {
        expect(config.headers['Content-Type']).toEqual('application/x-www-form-urlencoded')
        const data = qs.parse(config.data)
        expect(data).toHaveProperty('api_key')
        expect(data).toHaveProperty('sponsor_id')
        expect(data.sponsor_id).toBeDefined()
        expect(data.api_key).toEqual(process.env.VERA_SYSTEM_API_KEY)
        const expectedOrderKeys = Object.keys(veraSystemExpected[mockJobContext.localData.jobInfo.targetEndpoint])
        const dataKeys = Object.keys(data)
        expect(dataKeys).toEqual(expectedOrderKeys)
        for (let prop of dataKeys) {
          expect(data[prop]).toBeDefined()
        }
        return [200, successMock]
      })
      const handler = new VeraSystemAddDistributorHandler(mockEvent, mockJobContext)
      const jobData = await handler.getJobData()
      const distributor = jobData.pop()
      const response = await handler.sendDistributorsToVeraSystem(distributor)
      expect(response.status).toEqual(200)
      expect(response.data).toEqual(successMock)
    })

    each(testCases).test('%s - should set default sponsor id for client custom api', async (source, mockEvent) => {
      const successMock = mockResponse.success
      mockVeraSystemAxios.onPost('/add_distributor').reply(config => {
        expect(config.headers['Content-Type']).toEqual('application/x-www-form-urlencoded')
        const data = qs.parse(config.data)
        expect(data).toHaveProperty('api_key')
        expect(data).toHaveProperty('sponsor_id')
        expect(data.api_key).toEqual(process.env.VERA_SYSTEM_API_KEY)
        expect(data.sponsor_id).toEqual(process.env.VERA_DEFAULT_ROOT_SPONSOR_ID)
        const expectedOrderKeys = Object.keys(veraSystemExpected[mockJobContext.localData.jobInfo.targetEndpoint])
        const dataKeys = Object.keys(data)
        expect(dataKeys).toEqual(expectedOrderKeys)
        for (let prop of dataKeys) {
          expect(data[prop]).toBeDefined()
        }
        return [200, successMock]
      })
      const handler = new VeraSystemAddDistributorHandler(mockEvent, mockJobContext)
      const jobData = await handler.getJobData()
      const distributor = jobData.pop()
      distributor.sponsor_id = null
      const response = await handler.sendDistributorsToVeraSystem(distributor)
      expect(response.status).toEqual(200)
      expect(response.data).toEqual(successMock)
    })

    each(testCases).test('%s - should be able to send email notifications for errors upon MPP query', async (source, mockEvent) => {
      mockMsaAxios.onPost('/queries').networkError()
      const localEvent = { ...mockEvent }
      if (source === 'aws.lambda') {
        localEvent.payload = ''
      }
      const handler = new VeraSystemAddDistributorHandler(localEvent, mockJobContext)
      const callback = (error) => {
        expect(error).toBeTruthy()
        expect(helper.notify_on_error).toHaveBeenCalledTimes(1)
        if (handler.isReinvoked()) {
          expect(helper.release_failed_job).toHaveBeenCalledTimes(1)
          expect(helper.release_failed_job).toHaveBeenCalledWith(localEvent.receiptHandle)
        }
      }
      await handler.main(callback)
    })

    describe('Test Case: aws.events', () => {
      test('should be able to execute all successfully from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(0)
          expect(result.notify).toHaveLength(0)
          expect(result.success).toHaveLength(mockDistributors.length)
          result.success.map(suc => {
            expect(suc).toHaveProperty('data')
            expect(suc).toHaveProperty('result')
            expect(suc.result).toHaveProperty('status')
            expect(suc.result.status).toEqual(200)
            expect(suc.result.data).toEqual(mockResponse.success)
          })
        }
        mockVeraSystemAxios.onPost('/add_distributor').reply(200, mockResponse.success)
        await main(mockCloudwatchScheduledEvent, mockJobContext, callback)
      })
      test('should be able to enqueue failed job data from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(mockDistributors.length)
          expect(result.notify).toHaveLength(0)
          expect(result.success).toHaveLength(0)
          result.fail.map(failure => {
            expect(failure).toHaveProperty('data')
            expect(failure).toHaveProperty('error')
          })
          expect(helper.enqueue_failed_job).toHaveBeenCalledTimes(1)
          expect(helper.enqueue_failed_job).toHaveBeenCalledWith(
            result.fail,
            mockJobContext.functionName
          )
        }
        mockVeraSystemAxios.onPost('/add_distributor').networkError()
        await main(mockCloudwatchScheduledEvent, mockJobContext, callback)
      })

      test('should be able to send email notifications for invalid client data from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(0)
          expect(result.notify).toHaveLength(mockDistributors.length)
          expect(result.success).toHaveLength(0)
          result.notify.map(failure => {
            expect(failure).toHaveProperty('data')
            expect(failure).toHaveProperty('error')
          })
          expect(helper.notify_on_failed_queue).toHaveBeenCalledTimes(1)
          expect(helper.enqueue_failed_job).not.toHaveBeenCalled()
        }
        mockVeraSystemAxios.onPost('/add_distributor').reply(400, mockResponse.fail)
        await main(mockCloudwatchScheduledEvent, mockJobContext, callback)
      })
    })
    describe('Test Case: aws.lambda (Re-Invoke)', () => {
      test('should be able to execute all successfully from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(0)
          expect(result.notify).toHaveLength(0)
          expect(result.success).toHaveLength(mockDistributors.length)
          result.success.map(suc => {
            expect(suc).toHaveProperty('data')
            expect(suc).toHaveProperty('result')
            expect(suc.result).toHaveProperty('status')
            expect(suc.result.status).toEqual(200)
            expect(suc.result.data).toEqual(mockResponse.success)
          })
          expect(helper.delete_failed_job).toHaveBeenCalledTimes(1)
          expect(helper.delete_failed_job).toHaveBeenCalledWith(
            mockLambdaReinvokeEvent.receiptHandle
          )
        }
        mockVeraSystemAxios.onPost('/add_distributor')
          .reply(200, mockResponse.success)
        await main(mockLambdaReinvokeEvent, mockJobContext, callback)
      })
      test('should be able to re-enqueue network errors from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(mockDistributors.length)
          expect(result.notify).toHaveLength(0)
          expect(result.success).toHaveLength(0)
          result.fail.map(failure => {
            expect(failure).toHaveProperty('data')
            expect(failure).toHaveProperty('error')
          })
          expect(helper.release_failed_job).toHaveBeenCalledTimes(1)
          expect(helper.release_failed_job).toHaveBeenCalledWith(
            mockLambdaReinvokeEvent.receiptHandle
          )
        }
        mockVeraSystemAxios.onPost('/add_distributor').networkError()
        await main(mockLambdaReinvokeEvent, mockJobContext, callback)
      })
      test('should be able to send email notifications for invalid client data from main', async () => {
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('success')
          expect(result).toHaveProperty('notify')
          expect(result.fail).toHaveLength(0)
          expect(result.notify).toHaveLength(mockDistributors.length)
          expect(result.success).toHaveLength(0)
          result.notify.map(notification => {
            expect(notification).toHaveProperty('data')
            expect(notification).toHaveProperty('error')
          })
          expect(helper.notify_on_failed_queue).toHaveBeenCalledTimes(1)
          expect(helper.release_failed_job).not.toHaveBeenCalled()
        }
        mockVeraSystemAxios.onPost('/add_distributor').reply(400, mockResponse.fail)
        await main(mockLambdaReinvokeEvent, mockJobContext, callback)
      })
      test('should be able to send email notifications for failed job data that exceed retries threshold from main', async () => {
        const localEvent = { ...mockLambdaReinvokeEvent, ...{ retries: process.env.DEFAULT_NOTIFY_RETRIES_THRESHOLD } }
        const callback = (error, result) => {
          expect(error).toBeNull()
          expect(result).toHaveProperty('fail')
          expect(result).toHaveProperty('notify')
          expect(result).toHaveProperty('success')
          expect(result.fail).toHaveLength(mockDistributors.length)
          expect(result.notify).toHaveLength(0)
          expect(result.success).toHaveLength(0)
          result.fail.map(failure => {
            expect(failure).toHaveProperty('data')
            expect(failure).toHaveProperty('error')
          })
          expect(helper.notify_on_failed_queue).toHaveBeenCalledTimes(1)
          expect(helper.notify_on_failed_queue).toHaveBeenCalled()
          expect(helper.release_failed_job).toHaveBeenCalledTimes(1)
          expect(helper.release_failed_job).toHaveBeenCalledWith(
            mockLambdaReinvokeEvent.receiptHandle
          )
        }
        mockVeraSystemAxios.onPost('/add_distributor').networkError()
        await main(localEvent, mockJobContext, callback)
      })
    })
  })
})
