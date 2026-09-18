import { Router } from 'express'
import { HttpStatus } from '../../shared/errors'
import { serialize } from './comments.mapper'
import { commentIdParamSchema, createCommentBodySchema } from './comments.schema'
import { CommentsService } from './comments.service'

export function commentsRouter(service: CommentsService): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createCommentBodySchema.parse(req.body)
      const { comment, created } = await service.create(body)
      res.status(created ? HttpStatus.Created : HttpStatus.Ok).json(serialize(comment))
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = commentIdParamSchema.parse(req.params)
      const comment = await service.getById(id)
      res.json(serialize(comment))
    } catch (err) {
      next(err)
    }
  })

  return router
}
