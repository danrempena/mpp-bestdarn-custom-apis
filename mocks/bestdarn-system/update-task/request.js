import faker from 'faker'

export default {
  generate: (defaults = {}) => {
    return {
      'assignee': faker.random.number({ min: 1, max: 10 }),
      'date_due': '2020-01-22',
      ...defaults
    }
  }
}
