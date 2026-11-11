import * as NotificationService from './notification.service.js';

export const getRecipients = async (req, res, next) => {
  try {
    const recipients = await NotificationService.getAllRecipients();
    return res.status(200).json({
      success: true,
      message: 'Notification recipients retrieved successfully',
      data: { recipients }
    });
  } catch (error) {
    next(error);
  }
};

export const createRecipient = async (req, res, next) => {
  try {
    const recipient = await NotificationService.createRecipient(req.body);
    return res.status(201).json({
      success: true,
      message: 'Notification recipient added successfully',
      data: { recipient }
    });
  } catch (error) {
    next(error);
  }
};

export const updateRecipient = async (req, res, next) => {
  try {
    const recipient = await NotificationService.updateRecipient(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      message: 'Notification recipient updated successfully',
      data: { recipient }
    });
  } catch (error) {
    next(error);
  }
};

export const updateRecipientStatus = async (req, res, next) => {
  try {
    const recipient = await NotificationService.updateRecipientStatus(
      req.params.id,
      req.body.isActive
    );
    return res.status(200).json({
      success: true,
      message: `Notification recipient ${recipient.isActive ? 'enabled' : 'disabled'} successfully`,
      data: { recipient }
    });
  } catch (error) {
    next(error);
  }
};

export const deleteRecipient = async (req, res, next) => {
  try {
    const result = await NotificationService.deleteRecipient(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Notification recipient removed successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

